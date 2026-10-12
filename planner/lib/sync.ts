import 'server-only';
import { createHash } from 'node:crypto';
import { database } from './admin';
import {
  active,
  boundedFetch,
  connection,
  googleConfig,
  HttpError,
  identifier,
  normalizeTask,
  putTask,
  saveConnection,
  seal,
  unseal,
  type AuthContext,
} from './server';
import { safeUrl, validDate } from './domain';
import type { Task } from './types';
export type Provider = 'canvas' | 'google';
export type Google = { refresh: string; calendar?: string };
type Course = { id: number; name: string; course_code: string };
export type SyncState = {
  phase: string;
  cursor: string;
  index: number;
  courses: Course[];
  from: string;
  to: string;
  seen: string[];
};
export type SyncJob = {
  provider: Provider;
  jobId: string;
  status: 'pending' | 'done' | 'error';
  count: number;
  connectionRevision: number;
  credentialFingerprint: string;
  state: SyncState;
  lease: string;
  leaseUntil: number;
  completedAt?: number;
};
type GEvent = {
  id: string;
  etag?: string;
  status?: string;
  summary?: string;
  description?: string;
  updated?: string;
  htmlLink?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  extendedProperties?: {
    private?: {
      daymarkId?: string;
      category?: string;
      kind?: string;
      done?: string;
    };
  };
};
function stableId(value: string) {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}
function localParts(iso: string) {
  if (!Number.isFinite(Date.parse(iso)))
    throw new HttpError('The calendar returned an invalid date.');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Detroit',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
  };
}
function seen(job: SyncJob, id: string) {
  if (!job.state.seen.includes(id)) job.state.seen.push(id);
  if (job.state.seen.length > 15000)
    throw new HttpError(
      'This calendar exceeds the sync limit. Contact the project organizer; existing items are retained.',
    );
}
async function canvasPage(url: string, token: string) {
  const parsed = new URL(url);
  if (
    parsed.origin !== 'https://ia.instructure.com' ||
    !parsed.pathname.startsWith('/api/v1/')
  )
    throw new HttpError('Unexpected Canvas response.');
  const response = await boundedFetch(parsed.href, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!response.ok)
    throw new HttpError(
      response.status === 401 || response.status === 403
        ? 'Canvas rejected this token. Check its expiration and school permissions.'
        : 'Canvas is unavailable. Saved assignments are unchanged.',
    );
  const data: unknown = await response.json();
  if (!Array.isArray(data) || data.length > 100)
    throw new HttpError('Unexpected Canvas response.');
  const next =
    (response.headers.get('link') || '')
      .split(',')
      .find((v) => /rel="next"/.test(v))
      ?.match(/<([^>]+)>/)?.[1] || '';
  if (next && new URL(next).origin !== 'https://ia.instructure.com')
    throw new HttpError('Unexpected Canvas response.');
  return { data, next };
}
function canvasTask(
  auth: AuthContext,
  course: Course,
  value: unknown,
): Task | null {
  if (!value || typeof value !== 'object')
    throw new HttpError('Unexpected Canvas assignment.');
  const a = value as {
    id: number;
    name: string;
    due_at?: string | null;
    description?: string;
    published?: boolean;
    submission?: { submitted_at?: string; workflow_state?: string };
  };
  if (!Number.isSafeInteger(a.id) || typeof a.name !== 'string')
    throw new HttpError('Unexpected Canvas assignment.');
  if (a.published === false) return null;
  const due = a.due_at ? localParts(a.due_at) : { date: null, time: '' },
    sourceId = `${course.id}:${a.id}`;
  return {
    id: stableId(`${auth.owner}:canvas:${sourceId}`),
    title: a.name.slice(0, 200),
    category: 'school',
    kind: 'task',
    date: due.date,
    time: due.time,
    endTime: '',
    notes: (a.description || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .slice(0, 10000),
    course: (course.course_code || course.name).slice(0, 150),
    priority: 'normal',
    done:
      a.submission?.submitted_at ||
      ['submitted', 'graded'].includes(a.submission?.workflow_state || '')
        ? 1
        : 0,
    source: 'canvas',
    sourceId,
    sourceUrl: `https://ia.instructure.com/courses/${course.id}/assignments/${a.id}`,
    updated: new Date().toISOString(),
    deleted: 0,
    revision: 1,
  };
}
async function canvasWrites(auth: AuthContext, job: SyncJob, tasks: Task[]) {
  if (!tasks.length) return;
  const refs = tasks.map((t) =>
    database().doc(`users/${auth.owner}/tasks/${t.id}`),
  );
  await database().runTransaction(async (tx) => {
    await active(tx, auth);
    const docs = await tx.getAll(...refs);
    tasks.forEach((task, i) => {
      const old = docs[i].data() as Task | undefined;
      const next = {
        ...task,
        done: old?.done || task.done,
        priority: old?.priority || task.priority,
        ...(old?.googleId ? { googleId: old.googleId } : {}),
        revision: (old?.revision || 0) + 1,
      };
      const changed =
        !old ||
        old.title !== next.title ||
        old.date !== next.date ||
        old.time !== next.time ||
        old.notes !== next.notes ||
        old.course !== next.course ||
        old.done !== next.done ||
        old.deleted;
      if (changed) tx.set(refs[i], next);
    });
  });
  for (const task of tasks) seen(job, task.id);
}
async function cleanup(auth: AuthContext, job: SyncJob) {
  let query = database()
    .collection(`users/${auth.owner}/tasks`)
    .orderBy('__name__')
    .limit(100);
  if (job.state.cursor) query = query.startAfter(job.state.cursor);
  const page = await query.get();
  for (const doc of page.docs) {
    const task = normalizeTask({ ...doc.data(), id: doc.id });
    if (!task || task.deleted) continue;
    const relevant =
      job.provider === 'canvas'
        ? task.source === 'canvas' &&
          job.state.courses.some(
            (c) => String(c.id) === task.sourceId?.split(':')[0],
          )
        : task.source === 'google' &&
          !!task.date &&
          task.date >= job.state.from.slice(0, 10) &&
          task.date <= job.state.to.slice(0, 10);
    if (relevant && !job.state.seen.includes(task.id))
      await putTask(
        auth,
        { ...task, deleted: 1, updated: new Date().toISOString() },
        task.revision,
      );
  }
  if (page.size === 100) job.state.cursor = page.docs.at(-1)!.id;
  else job.status = 'done';
}
async function canvasStep(auth: AuthContext, job: SyncJob) {
  const conn = await connection(auth);
  if (!conn.canvas) throw new HttpError('Canvas was disconnected.', 409);
  const { token } = await unseal<{ token: string }>(conn.canvas);
  if (job.state.phase === 'courses') {
    const page = await canvasPage(
      job.state.cursor ||
        'https://ia.instructure.com/api/v1/courses?enrollment_state=active&per_page=100',
      token,
    );
    for (const value of page.data) {
      const c = value as Course;
      if (!Number.isSafeInteger(c.id) || typeof c.name !== 'string')
        throw new HttpError('Unexpected Canvas course.');
      job.state.courses.push({
        id: c.id,
        name: c.name.slice(0, 150),
        course_code:
          typeof c.course_code === 'string' ? c.course_code.slice(0, 150) : '',
      });
    }
    if (job.state.courses.length > 200)
      throw new HttpError(
        'Canvas returned too many active courses. Contact the project organizer.',
      );
    job.state.cursor = page.next;
    if (!page.next) {
      job.state.phase = 'assignments';
      job.state.cursor = '';
    }
    return;
  }
  if (job.state.phase === 'assignments') {
    const course = job.state.courses[job.state.index];
    if (!course) {
      job.state.phase = 'cleanup';
      job.state.cursor = '';
      return;
    }
    const page = await canvasPage(
      job.state.cursor ||
        `https://ia.instructure.com/api/v1/courses/${course.id}/assignments?per_page=100&include[]=submission`,
      token,
    );
    const tasks = page.data
      .map((value) => canvasTask(auth, course, value))
      .filter((t): t is Task => !!t);
    await canvasWrites(auth, job, tasks);
    job.count += tasks.length;
    job.state.cursor = page.next;
    if (!page.next) job.state.index++;
    return;
  }
  await cleanup(auth, job);
}
export async function googleToken(google: Google) {
  const config = googleConfig(),
    response = await boundedFetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: google.refresh,
        grant_type: 'refresh_token',
      }),
    });
  const data = (await response.json()) as { access_token?: string };
  if (!response.ok || !data.access_token)
    throw new HttpError('Reconnect Google Calendar to resume syncing.');
  return data.access_token;
}
async function googleCall(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<Record<string, unknown> | null> {
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('Content-Type', 'application/json');
  const response = await boundedFetch(
    'https://www.googleapis.com/calendar/v3' + path,
    { ...options, headers },
  );
  if ([204, 404, 410].includes(response.status)) return null;
  if (response.status === 412)
    throw new HttpError(
      'Google changed this event during sync. Retry to reconcile it.',
      409,
    );
  if (!response.ok)
    throw new HttpError(
      response.status === 401 || response.status === 403
        ? 'Reconnect Google Calendar and grant its requested permissions.'
        : `Google Calendar could not complete this sync (${response.status}). Saved items are unchanged.`,
    );
  return (await response.json()) as Record<string, unknown>;
}
async function importGoogle(
  auth: AuthContext,
  event: GEvent,
  source: 'manual' | 'google',
  id: string,
  existing?: Task,
) {
  if (!event.start || !event.id || event.status === 'cancelled') return;
  const start = event.start.date
    ? { date: event.start.date, time: '' }
    : localParts(event.start.dateTime || '');
  if (!validDate(start.date))
    throw new HttpError('Google returned an invalid date.');
  const end = event.end?.dateTime
    ? localParts(event.end.dateTime)
    : event.end?.date
      ? {
          date: new Date(Date.parse(event.end.date + 'T12:00:00Z') - 86400000)
            .toISOString()
            .slice(0, 10),
          time: '',
        }
      : null;
  const old =
    existing ||
    (await database()
      .doc(`users/${auth.owner}/tasks/${identifier(id)}`)
      .get()
      .then((d) =>
        d.exists ? normalizeTask({ ...d.data(), id: d.id }) : null,
      ));
  if (old && old.updated > (event.updated || '')) return;
  if (old && !old.deleted && old.updated === event.updated) return;
  const next: Task = {
    id,
    title: (event.summary || 'Untitled event').replace(/^✓ /, '').slice(0, 200),
    category: source === 'google' ? 'life' : old?.category || 'life',
    kind: source === 'google' ? 'event' : old?.kind || 'event',
    date: start.date,
    time: start.time,
    endTime: end?.time || '',
    ...(end && end.date > start.date ? { endDate: end.date } : {}),
    notes: (event.description || '').slice(0, 10000),
    course: old?.course || '',
    priority: old?.priority || 'normal',
    done: source === 'manual' && event.summary?.startsWith('✓ ') ? 1 : 0,
    source,
    sourceId: event.id,
    sourceUrl: safeUrl(event.htmlLink || ''),
    ...(source === 'manual' ? { googleId: event.id } : {}),
    updated: event.updated || new Date().toISOString(),
    deleted: 0,
    revision: old?.revision || 1,
  };
  await putTask(auth, next, old?.revision);
}
async function exportGoogle(
  auth: AuthContext,
  calendar: string,
  token: string,
  task: Task,
) {
  if (task.source === 'google' || !task.date) return;
  const legacyId = task.id.replace(/-/g, '');
  const id =
      task.googleId ||
      (/^[0-9a-v]{5,1024}$/.test(legacyId)
        ? legacyId
        : stableId(`${auth.owner}:calendar:${task.id}`)),
    path = `/calendars/${encodeURIComponent(calendar)}/events/${encodeURIComponent(id)}`,
    remote = (await googleCall(path, token)) as GEvent | null;
  if (task.deleted) {
    if (remote && remote.status !== 'cancelled') {
      await database().runTransaction((tx) => active(tx, auth));
      await googleCall(path, token, {
        method: 'DELETE',
        headers: remote.etag ? { 'If-Match': remote.etag } : {},
      });
    }
    return;
  }
  if (remote?.status === 'cancelled' && task.source === 'manual') {
    await putTask(
      auth,
      {
        ...task,
        deleted: 1,
        updated: remote.updated || new Date().toISOString(),
      },
      task.revision,
    );
    return;
  }
  const pendingExport =
    !!task.googlePendingUpdated &&
    remote?.updated === task.googlePendingUpdated;
  if (
    !pendingExport &&
    remote?.updated &&
    task.googleId &&
    remote.updated > task.updated &&
    task.source === 'manual'
  ) {
    await importGoogle(auth, remote, 'manual', task.id, task);
    return;
  }
  if (
    !pendingExport &&
    remote &&
    remote.status !== 'cancelled' &&
    task.updated <= (remote.updated || '')
  ) {
    if (!task.googleId)
      await putTask(auth, { ...task, googleId: id }, task.revision);
    return;
  }
  // Read the current revision immediately before the external write. If it changed, the next pass handles it.
  const current = await database()
    .doc(`users/${auth.owner}/tasks/${task.id}`)
    .get();
  if (current.data()?.revision !== task.revision) return;
  let start: Record<string, string> = { date: task.date },
    end: Record<string, string> = {
      date: new Date(
        Date.parse((task.endDate || task.date) + 'T12:00:00Z') + 86400000,
      )
        .toISOString()
        .slice(0, 10),
    };
  if (task.time) {
    start = {
      dateTime: `${task.date}T${task.time}:00`,
      timeZone: 'America/Detroit',
    };
    const endWall = new Date(`${task.date}T${task.time}:00Z`);
    endWall.setUTCMinutes(endWall.getUTCMinutes() + 30);
    end = {
      dateTime: task.endTime
        ? `${task.endDate || task.date}T${task.endTime}:00`
        : endWall.toISOString().replace('Z', ''),
      timeZone: 'America/Detroit',
    };
  }
  const body = {
    ...(remote ? {} : { id }),
    status: 'confirmed',
    summary: (task.done ? '✓ ' : '') + task.title,
    description: task.notes,
    start,
    end,
    ...(task.sourceUrl
      ? { source: { url: task.sourceUrl, title: 'DueNext' } }
      : {}),
    extendedProperties: {
      private: {
        daymarkId: task.id,
        category: task.category,
        kind: task.kind,
        done: String(task.done),
      },
    },
  };
  await database().runTransaction((tx) => active(tx, auth));
  const saved = await googleCall(
    remote ? path : `/calendars/${encodeURIComponent(calendar)}/events`,
    token,
    {
      method: remote ? 'PUT' : 'POST',
      headers: remote?.etag ? { 'If-Match': remote.etag } : {},
      body: JSON.stringify(body),
    },
  );
  if (!saved || typeof saved.updated !== 'string')
    throw new HttpError('Google did not confirm this event. Retry sync.');
  try {
    await putTask(
      auth,
      {
        ...task,
        googleId: id,
        googlePendingUpdated: undefined,
        updated: saved.updated,
      },
      task.revision,
    );
  } catch (e) {
    if (e instanceof HttpError && e.status === 409) {
      // A newer local edit must never be replaced by the stale body just sent to Google.
      await database().runTransaction(async (tx) => {
        await active(tx, auth);
        const ref = database().doc(`users/${auth.owner}/tasks/${task.id}`),
          current = await tx.get(ref);
        if (current.exists)
          tx.update(ref, { googleId: id, googlePendingUpdated: saved.updated });
      });
    }
    throw e;
  }
}
async function googleStep(auth: AuthContext, job: SyncJob) {
  const conn = await connection(auth);
  if (!conn.google) throw new HttpError('Google was disconnected.', 409);
  const google = await unseal<Google>(conn.google),
    token = await googleToken(google);
  if (!google.calendar) {
    // A lost create-calendar response requires operator reconciliation, rather than automatic duplicate calendars.
    const ref = database().doc(`users/${auth.owner}/syncJobs/google`);
    if (job.state.phase === 'creating-calendar')
      throw new HttpError(
        'Google calendar creation was interrupted. Contact the project organizer before retrying.',
      );
    job.state.phase = 'creating-calendar';
    await database().runTransaction(async (tx) => {
      await active(tx, auth);
      tx.update(ref, { 'state.phase': 'creating-calendar' });
    });
    await database().runTransaction((tx) => active(tx, auth));
    const result = await googleCall('/calendars', token, {
      method: 'POST',
      body: JSON.stringify({
        summary: 'DueNext',
        description: 'Your private DueNext plans.',
        timeZone: 'America/Detroit',
      }),
    });
    if (typeof result?.id !== 'string')
      throw new HttpError('Google did not confirm calendar creation.');
    google.calendar = result.id;
    conn.google = await seal(google);
    await saveConnection(auth, conn, 'google');
    job.connectionRevision = conn.revision;
    job.state.phase = 'outbound';
  }
  if (job.state.phase === 'outbound') {
    let query = database()
      .collection(`users/${auth.owner}/tasks`)
      .orderBy('__name__')
      .limit(5);
    if (job.state.cursor) query = query.startAfter(job.state.cursor);
    const page = await query.get(),
      started = Date.now();
    let handled = 0;
    for (const doc of page.docs) {
      if (handled && Date.now() - started > 15000) return;
      const task = normalizeTask({ ...doc.data(), id: doc.id });
      if (task) await exportGoogle(auth, google.calendar, token, task);
      job.state.cursor = doc.id;
      job.count++;
      handled++;
    }
    if (page.size < 5) {
      job.state.phase = 'own-events';
      job.state.cursor = '';
    }
    return;
  }
  if (job.state.phase === 'cleanup') {
    await cleanup(auth, job);
    return;
  }
  const primary = job.state.phase === 'primary',
    calendar = primary ? 'primary' : google.calendar;
  const query = new URLSearchParams({
    maxResults: '100',
    singleEvents: 'true',
    showDeleted: 'true',
    timeMin: job.state.from,
    timeMax: job.state.to,
    ...(job.state.cursor ? { pageToken: job.state.cursor } : {}),
  });
  const data = await googleCall(
    `/calendars/${encodeURIComponent(calendar)}/events?${query}`,
    token,
  );
  if (!data || !Array.isArray(data.items))
    throw new HttpError('Google returned an incomplete calendar page.');
  for (const event of data.items as GEvent[]) {
    if (event.status === 'cancelled' || !event.start) continue;
    let id = stableId(`${auth.owner}:${primary ? 'g' : 'g-own'}:${event.id}`),
      existing: Task | undefined;
    if (!primary && event.extendedProperties?.private?.daymarkId) {
      try {
        const candidate = identifier(
            event.extendedProperties.private.daymarkId,
          ),
          doc = await database()
            .doc(`users/${auth.owner}/tasks/${candidate}`)
            .get();
        const task = doc.exists
          ? normalizeTask({ ...doc.data(), id: doc.id })
          : null;
        if (
          task &&
          (task.googleId === event.id || task.id.replace(/-/g, '') === event.id)
        ) {
          if (task.source !== 'manual') continue;
          id = candidate;
          existing = task;
        }
      } catch {
        /* Untrusted calendar metadata never selects an arbitrary planner path. */
      }
    }
    if (!primary && !existing) {
      const match = await database()
        .collection(`users/${auth.owner}/tasks`)
        .where('googleId', '==', event.id)
        .limit(1)
        .get();
      if (match.docs[0]) {
        const task = normalizeTask({
          ...match.docs[0].data(),
          id: match.docs[0].id,
        });
        if (task?.source !== 'manual') continue;
        existing = task || undefined;
        id = match.docs[0].id;
      }
    }
    await importGoogle(
      auth,
      event,
      primary ? 'google' : 'manual',
      id,
      existing,
    );
    if (primary) seen(job, id);
    job.count++;
  }
  job.state.cursor =
    typeof data.nextPageToken === 'string' ? data.nextPageToken : '';
  if (!job.state.cursor) job.state.phase = primary ? 'cleanup' : 'primary';
}
export async function syncStep(auth: AuthContext, job: SyncJob) {
  if (job.provider === 'canvas') await canvasStep(auth, job);
  else await googleStep(auth, job);
}
