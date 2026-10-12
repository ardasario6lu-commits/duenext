import 'server-only';
import { createHash } from 'node:crypto';
import type { Transaction } from 'firebase-admin/firestore';
import { FieldPath } from 'firebase-admin/firestore';
import { adminAuth, database } from './admin';
import { HttpError, identifier, object, safeUrl, validDate } from './domain';
import { taskOrder, type Task } from './types';
export { HttpError, readBody, identifier } from './domain';
export type AuthContext = {
  owner: string;
  token: string;
  authTime?: number;
  browserSession?: string;
  oauth?: string;
  migration?: boolean;
  sync?: { provider: string; lease: string; connectionRevision: number };
};
export async function user(
  req: Request,
  allowDeleting = false,
): Promise<AuthContext> {
  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || token.length > 8192)
    throw new HttpError('Sign in with Google to use your planner.', 401);
  const auth = adminAuth();
  let claims;
  try {
    claims = await auth.verifyIdToken(token, true);
  } catch {
    throw new HttpError('Your sign-in expired. Sign in again.', 401);
  }
  const owner = identifier(claims.uid);
  const profile = (await database().doc(`users/${owner}`).get()).data();
  if (!allowDeleting && profile?.deleting)
    throw new HttpError('This account is being deleted.', 403);
  if (!allowDeleting && profile?.migrating)
    throw new HttpError(
      'Your planner is being upgraded. Please try again shortly.',
      503,
    );
  const session = req.headers.get('x-planner-session');
  if (session) {
    identifier(session);
    if (
      (
        await database().doc(`users/${owner}/browserSessions/${session}`).get()
      ).data()?.revoked
    )
      throw new HttpError('This browser session ended. Sign in again.', 401);
  }
  return {
    owner,
    token,
    authTime: claims.auth_time,
    ...(session ? { browserSession: session } : {}),
  };
}
export function failure(e: unknown) {
  const known = e instanceof HttpError;
  console.error('Planner request rejected', { status: known ? e.status : 500 });
  return json(
    { error: known ? e.message : 'Something went wrong. Please try again.' },
    { status: known ? e.status : 500 },
  );
}
export function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  return Response.json(data, { ...init, headers });
}
export function appOrigin(req?: Request) {
  const configured = process.env.APP_ORIGIN;
  if (!configured && process.env.NODE_ENV === 'production')
    throw new HttpError('The app address needs configuration.', 503);
  const url = new URL(configured || req?.url || 'http://localhost:3000');
  if (
    url.protocol !== 'https:' &&
    !(
      ['localhost', '127.0.0.1'].includes(url.hostname) &&
      process.env.NODE_ENV !== 'production'
    )
  )
    throw new HttpError('Invalid app address.', 503);
  if (url.username || url.password)
    throw new HttpError('Invalid app address.', 503);
  return url.origin;
}
export function guard(req: Request) {
  const origin = req.headers.get('origin');
  if (origin && origin !== appOrigin(req))
    throw new HttpError('Please make changes from your planner.', 403);
  if (req.headers.get('sec-fetch-site') === 'cross-site')
    throw new HttpError('Please make changes from your planner.', 403);
}
export function ownerPath(auth: AuthContext, path: string) {
  const prefix = `users/${identifier(auth.owner)}/`;
  if (
    !path.startsWith(prefix) ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new HttpError('Private planner access denied.', 403);
  return path;
}
export async function active(tx: Transaction, auth: AuthContext) {
  const profile = (
    await tx.get(database().doc(`users/${identifier(auth.owner)}`))
  ).data();
  if (profile?.deleting)
    throw new HttpError('This account is being deleted.', 403);
  if (profile?.migrating && !auth.migration)
    throw new HttpError(
      'Your planner is being upgraded. Please try again shortly.',
      503,
    );
  if (
    auth.browserSession &&
    (
      await tx.get(
        database().doc(
          `users/${auth.owner}/browserSessions/${identifier(auth.browserSession)}`,
        ),
      )
    ).data()?.revoked
  )
    throw new HttpError('This browser session ended.', 401);
  if (auth.oauth) {
    const state = (
      await tx.get(
        database().doc(`users/${auth.owner}/oauth/${identifier(auth.oauth)}`),
      )
    ).data();
    if (
      !state?.used ||
      Number(state.expires) < Date.now() ||
      Number(state.generation || 0) !== Number(profile?.oauthGeneration || 0)
    )
      throw new HttpError('Authorization session ended.', 401);
  }
  if (auth.sync) {
    const job = (
        await tx.get(
          database().doc(
            `users/${auth.owner}/syncJobs/${identifier(auth.sync.provider)}`,
          ),
        )
      ).data(),
      conn = (
        await tx.get(database().doc(`users/${auth.owner}/private/connections`))
      ).data();
    if (
      job?.lease !== auth.sync.lease ||
      Number(job.leaseUntil) < Date.now() ||
      createHash('sha256')
        .update(String(conn?.[auth.sync.provider] || ''))
        .digest('hex') !== job.credentialFingerprint
    )
      throw new HttpError('This sync was cancelled. Start again.', 409);
  }
  return profile;
}
export async function getDocument(auth: AuthContext, path: string) {
  return (await database().doc(ownerPath(auth, path)).get()).data() || null;
}
export async function putDocument(
  auth: AuthContext,
  path: string,
  value: Record<string, unknown>,
) {
  const ref = database().doc(ownerPath(auth, path));
  await database().runTransaction(async (tx) => {
    await active(tx, auth);
    tx.set(ref, value, { merge: true });
  });
}
export async function rateLimit(
  auth: AuthContext,
  bucket: string,
  max = 60,
  windowMs = 60000,
) {
  const ref = database().doc(
      `users/${identifier(auth.owner)}/limits/${identifier(bucket)}`,
    ),
    now = Date.now();
  await database().runTransaction(async (tx) => {
    await active(tx, auth);
    const old = (await tx.get(ref)).data();
    const fresh = !old || Number(old.until) <= now;
    const count = fresh ? 0 : Number(old.count);
    if (count >= max)
      throw new HttpError('Please wait a moment before trying again.', 429);
    tx.set(ref, {
      count: count + 1,
      until: fresh ? now + windowMs : old?.until,
    });
  });
}
function bytes(value: string) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
async function key() {
  const raw = process.env.TOKEN_KEY;
  if (!raw) throw new HttpError('Connections are not configured yet.', 503);
  let value;
  try {
    value = bytes(raw);
  } catch {
    throw new HttpError('Connections need configuration.', 503);
  }
  if (value.length !== 32)
    throw new HttpError('Connections need configuration.', 503);
  return crypto.subtle.importKey('raw', value, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}
export async function seal(data: unknown) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await key(),
    new TextEncoder().encode(JSON.stringify(data)),
  );
  return (
    Buffer.from(iv).toString('base64') +
    '.' +
    Buffer.from(encrypted).toString('base64')
  );
}
export async function unseal<T>(data: string): Promise<T> {
  try {
    const [a, b, ...rest] = data.split('.');
    if (!a || !b || rest.length) throw new Error();
    const decoded = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes(a) },
      await key(),
      bytes(b),
    );
    return JSON.parse(new TextDecoder().decode(decoded)) as T;
  } catch (e) {
    if (e instanceof HttpError && e.status === 503) throw e;
    throw new HttpError('Reconnect this calendar to continue.');
  }
}
export function normalizeTask(raw: Record<string, unknown>): Task | null {
  try {
    const s = (name: string, fallback = '') =>
      typeof raw[name] === 'string' ? String(raw[name]) : fallback;
    const date = s('date') || s('dueDate') || null;
    if (date && !validDate(date)) return null;
    const source =
      raw.source === 'canvas' || raw.source === 'google'
        ? raw.source
        : 'manual';
    return {
      id: identifier(raw.id),
      title: s('title', 'Untitled').slice(0, 200),
      date,
      category: ['school', 'life', 'college'].includes(s('category'))
        ? (raw.category as Task['category'])
        : 'school',
      kind: raw.kind === 'event' || s('type') === 'event' ? 'event' : 'task',
      time: s('time') || s('dueTime'),
      endTime: s('endTime'),
      endDate: s('endDate') || undefined,
      notes: s('notes').slice(0, 10000),
      course: (s('course') || s('className')).slice(0, 150),
      priority: raw.priority === 'high' ? 'high' : 'normal',
      done: [true, 1, '1', 'true'].includes(
        raw.done as string | number | boolean,
      )
        ? 1
        : 0,
      source,
      sourceId: s('sourceId') || s('canvasId') || s('googleEventId'),
      sourceUrl: safeUrl(s('sourceUrl') || s('htmlUrl')),
      googleId: s('googleId') || undefined,
      googlePendingUpdated: s('googlePendingUpdated') || undefined,
      updated: s('updated') || s('updatedAt') || new Date(0).toISOString(),
      deleted: [true, 1, '1', 'true'].includes(
        raw.deleted as string | number | boolean,
      )
        ? 1
        : 0,
      revision: Number.isSafeInteger(raw.revision) ? Number(raw.revision) : 1,
    };
  } catch {
    return null;
  }
}
export async function taskPage(
  auth: AuthContext,
  cursor = '',
  limit = 200,
  includeDeleted = false,
) {
  if (cursor) identifier(cursor);
  if (!Number.isInteger(limit) || limit < 1 || limit > 300)
    throw new HttpError('Invalid page size.');
  let query = database()
    .collection(`users/${identifier(auth.owner)}/tasks`)
    .orderBy(FieldPath.documentId())
    .limit(limit);
  if (cursor) query = query.startAfter(cursor);
  const snapshot = await query.get();
  const tasks = snapshot.docs
    .map((d) => normalizeTask({ ...d.data(), id: d.id }))
    .filter((t): t is Task => !!t && (includeDeleted || !t.deleted));
  return {
    tasks,
    nextCursor: snapshot.size === limit ? snapshot.docs.at(-1)?.id : null,
  };
}
export async function listTasks(auth: AuthContext, includeDeleted = false) {
  let cursor = '';
  const tasks: Task[] = [];
  for (let page = 0; page < 100; page++) {
    const result = await taskPage(auth, cursor, 300, includeDeleted);
    tasks.push(...result.tasks);
    if (!result.nextCursor) return tasks.sort(taskOrder);
    cursor = result.nextCursor;
  }
  throw new HttpError('This planner is too large to load in one request.', 413);
}
export async function getTask(auth: AuthContext, id: string) {
  const doc = await database()
    .doc(`users/${identifier(auth.owner)}/tasks/${identifier(id)}`)
    .get();
  return doc.exists ? normalizeTask({ ...doc.data(), id: doc.id }) : null;
}
export function cleanTask(task: Task) {
  return Object.fromEntries(
    Object.entries(task).filter(([, v]) => v !== undefined),
  );
}
export async function putTask(
  auth: AuthContext,
  task: Task,
  expectedRevision?: number,
) {
  const ref = database().doc(
    `users/${identifier(auth.owner)}/tasks/${identifier(task.id)}`,
  );
  return database().runTransaction(async (tx) => {
    await active(tx, auth);
    const doc = await tx.get(ref),
      old = doc.exists ? normalizeTask({ ...doc.data(), id: doc.id }) : null;
    if (
      expectedRevision !== undefined &&
      (!old || old.revision !== expectedRevision)
    )
      throw new HttpError(
        'This item changed on another device. Reload and try again.',
        409,
      );
    // Provider writes must not replace a newer user edit. A later sync can reconcile it.
    if (expectedRevision === undefined && old && old.revision !== task.revision)
      return old;
    const next = { ...task, revision: (old?.revision || 0) + 1 };
    tx.set(ref, cleanTask(next));
    return next;
  });
}
export async function createTask(
  auth: AuthContext,
  task: Task,
  keyValue: string,
) {
  identifier(keyValue);
  const hash = createHash('sha256')
    .update(JSON.stringify({ ...task, id: '', updated: '', revision: 0 }))
    .digest('hex');
  const receipt = database().doc(
      `users/${identifier(auth.owner)}/requests/${keyValue}`,
    ),
    ref = database().doc(`users/${auth.owner}/tasks/${identifier(task.id)}`);
  return database().runTransaction(async (tx) => {
    await active(tx, auth);
    const old = await tx.get(receipt);
    if (old.exists) {
      if (old.data()?.hash !== hash)
        throw new HttpError(
          'This save key was already used for another item.',
          409,
        );
      const existing = await tx.get(
        database().doc(
          `users/${auth.owner}/tasks/${identifier(old.data()?.taskId)}`,
        ),
      );
      if (!existing.exists)
        throw new HttpError('The saved item is unavailable.', 409);
      return existing.data() as Task;
    }
    const next = { ...task, revision: 1 };
    tx.create(ref, cleanTask(next));
    tx.create(receipt, { hash, taskId: task.id });
    return next;
  });
}
export type Conn = {
  owner: string;
  canvas: string | null;
  google: string | null;
  last_canvas: string | null;
  last_google: string | null;
  revision: number;
  baselineCanvas: string | null;
  baselineGoogle: string | null;
};
export async function connection(auth: AuthContext): Promise<Conn> {
  const row = await getDocument(
    auth,
    `users/${auth.owner}/private/connections`,
  );
  return {
    owner: auth.owner,
    canvas: typeof row?.canvas === 'string' ? row.canvas : null,
    google: typeof row?.google === 'string' ? row.google : null,
    last_canvas: typeof row?.last_canvas === 'string' ? row.last_canvas : null,
    last_google: typeof row?.last_google === 'string' ? row.last_google : null,
    revision: Number(row?.revision) || 0,
    baselineCanvas: typeof row?.canvas === 'string' ? row.canvas : null,
    baselineGoogle: typeof row?.google === 'string' ? row.google : null,
  };
}
export async function saveConnection(
  auth: AuthContext,
  conn: Conn,
  provider?: 'canvas' | 'google',
) {
  const ref = database().doc(
    `users/${identifier(auth.owner)}/private/connections`,
  );
  const nextRevision = await database().runTransaction(async (tx) => {
    await active(tx, auth);
    const current = (await tx.get(ref)).data();
    const matches = provider
      ? (current?.[provider] || null) ===
        (provider === 'canvas' ? conn.baselineCanvas : conn.baselineGoogle)
      : (Number(current?.revision) || 0) === conn.revision;
    if (!matches)
      throw new HttpError('Your connection changed. Try again.', 409);
    const revision = (Number(current?.revision) || 0) + 1;
    const canvas =
      provider === 'google' ? current?.canvas || null : conn.canvas;
    const google =
      provider === 'canvas' ? current?.google || null : conn.google;
    tx.set(ref, {
      canvas,
      google,
      last_canvas:
        canvas !== (current?.canvas || null)
          ? conn.last_canvas
          : current?.last_canvas || null,
      last_google:
        google !== (current?.google || null)
          ? conn.last_google
          : current?.last_google || null,
      revision,
    });
    if (auth.sync)
      tx.update(
        database().doc(`users/${auth.owner}/syncJobs/${auth.sync.provider}`),
        {
          connectionRevision: revision,
          credentialFingerprint: createHash('sha256')
            .update(String(auth.sync.provider === 'canvas' ? canvas : google))
            .digest('hex'),
        },
      );
    return revision;
  });
  conn.revision = nextRevision;
  conn.baselineCanvas = conn.canvas;
  conn.baselineGoogle = conn.google;
  if (auth.sync) auth.sync.connectionRevision = conn.revision;
}
export async function boundedFetch(url: string, options: RequestInit = {}) {
  const response = await fetch(url, {
    ...options,
    redirect: 'manual',
    signal: options.signal || AbortSignal.timeout(15000),
  });
  if (response.status >= 300 && response.status < 400)
    throw new HttpError(
      'The calendar service returned an unexpected redirect. Try again.',
    );
  return response;
}
export function googleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID,
    clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (
    !clientId?.endsWith('.apps.googleusercontent.com') ||
    !clientSecret ||
    process.env.GOOGLE_CALENDAR_ENABLED !== 'true'
  )
    throw new HttpError(
      'Google Calendar is awaiting school launch configuration. Your planner still works without it.',
      503,
    );
  return { clientId, clientSecret };
}
export function recentAuth(auth: AuthContext) {
  if (!auth.authTime || Date.now() / 1000 - auth.authTime > 300)
    throw new HttpError(
      'Sign out and sign in again to confirm this action.',
      401,
    );
}
export function schoolAdmin(auth: AuthContext) {
  if (
    !process.env.SCHOOL_CALENDAR_ADMIN_UID ||
    auth.owner !== process.env.SCHOOL_CALENDAR_ADMIN_UID
  )
    throw new HttpError(
      'Only the school-calendar administrator can publish dates.',
      403,
    );
}
export function record(value: unknown) {
  return object(value);
}
