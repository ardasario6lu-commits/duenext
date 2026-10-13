import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { database, adminAuth } from '../../lib/admin';
import {
  connection,
  createTask,
  getDocument,
  ownerPath,
  putTask,
  saveConnection,
  seal,
  unseal,
  user,
} from '../../lib/server';
import { validateTask, type Task } from '../../lib/types';
import * as taskApi from '../../app/api/tasks/route';
import * as calendarApi from '../../app/api/school-calendar/route';
import * as timetableApi from '../../app/api/timetable/route';
import * as googleStart from '../../app/api/google/start/route';
import * as googleReturn from '../../app/api/google/return/route';
import * as accountApi from '../../app/api/account/route';
import { runSync } from '../../lib/sync-jobs';
let env: RulesTestEnvironment,
  tokenA = '',
  tokenB = '';
const ownerA = 'studentA',
  ownerB = 'studentB';
function req(
  path: string,
  token: string,
  method = 'GET',
  body?: unknown,
  key = 'test-key',
) {
  return new Request('http://localhost:3000/api/' + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      Origin: 'http://localhost:3000',
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const task = (id: string, title = 'Essay'): Task => ({
  id,
  ...validateTask({
    title,
    kind: 'task',
    category: 'school',
    date: '2026-10-09',
  }),
  revision: 1,
  source: 'manual',
  sourceUrl: '',
  updated: new Date().toISOString(),
  deleted: 0,
});
async function token(uid: string) {
  await adminAuth().createUser({
    uid,
    email: uid + '@example.test',
    emailVerified: true,
  });
  const custom = await adminAuth().createCustomToken(uid),
    response = await fetch(
      'http://127.0.0.1:9199/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-key',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: custom, returnSecureToken: true }),
      },
    );
  return ((await response.json()) as { idToken: string }).idToken;
}
beforeAll(async () => {
  if (
    !process.env.FIRESTORE_EMULATOR_HOST ||
    !process.env.FIREBASE_AUTH_EMULATOR_HOST
  )
    throw new Error('Run integration tests with the Firebase emulators.');
  process.env.FIREBASE_PROJECT_ID = 'demo-duenext-integration';
  process.env.APP_ORIGIN = 'http://localhost:3000';
  process.env.TOKEN_KEY = Buffer.alloc(32, 42).toString('base64');
  process.env.GOOGLE_CLIENT_ID = 'test.apps.googleusercontent.com';
  process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
  process.env.GOOGLE_CALENDAR_ENABLED = 'true';
  env = await initializeTestEnvironment({
    projectId: 'demo-duenext-integration',
    firestore: {
      host: '127.0.0.1',
      port: 8180,
      rules: readFileSync('firestore.rules', 'utf8'),
    },
  });
  await env.clearFirestore();
  await fetch(
    'http://127.0.0.1:9199/emulator/v1/projects/demo-duenext-integration/accounts',
    { method: 'DELETE' },
  );
  tokenA = await token(ownerA);
  tokenB = await token(ownerB);
});
afterAll(async () => {
  await env?.cleanup();
  vi.restoreAllMocks();
});
it('denies direct unauthenticated, owner and other-account database access', async () => {
  await database().doc('users/studentA/tasks/private').set(task('private'));
  for (const context of [
    env.unauthenticatedContext(),
    env.authenticatedContext(ownerA),
    env.authenticatedContext(ownerB),
  ]) {
    await assertFails(
      getDoc(doc(context.firestore(), 'users/studentA/tasks/private')),
    );
    await assertFails(
      setDoc(doc(context.firestore(), 'users/studentA/tasks/new'), {
        title: 'intrusion',
      }),
    );
    await assertFails(
      getDoc(doc(context.firestore(), 'users/studentA/private/connections')),
    );
  }
});
it('verifies identity, rejects forged and expired tokens, and scopes API reads and mutations', async () => {
  expect((await user(req('tasks', tokenA))).owner).toBe(ownerA);
  await expect(user(req('tasks', 'forged'))).rejects.toMatchObject({
    status: 401,
  });
  const parts = tokenA.split('.'),
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as {
      exp: number;
    };
  claims.exp = Math.floor(Date.now() / 1000) - 30;
  parts[1] = Buffer.from(JSON.stringify(claims)).toString('base64url');
  await expect(user(req('tasks', parts.join('.')))).rejects.toMatchObject({
    status: 401,
  });
  expect(() =>
    ownerPath({ owner: ownerA, token: tokenA }, 'users/studentB/tasks/private'),
  ).toThrow();
  const a = await taskApi.GET(req('tasks', tokenA));
  const b = await taskApi.GET(req('tasks', tokenB));
  expect((await a.json()).tasks).toHaveLength(1);
  expect((await b.json()).tasks).toHaveLength(0);
  const patch = await taskApi.PATCH(
    req('tasks', tokenB, 'PATCH', {
      id: 'private',
      revision: 1,
      completeOnly: true,
      done: true,
    }),
  );
  expect(patch.status).toBe(404);
  const traversal = await taskApi.DELETE(
    req('tasks', tokenA, 'DELETE', { id: '../studentB', revision: 1 }),
  );
  expect(traversal.status).toBe(400);
  const cross = new Request('http://localhost:3000/api/tasks', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + tokenA,
      Origin: 'https://attacker.test',
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  expect((await taskApi.POST(cross)).status).toBe(403);
});
it('keeps concurrent creates and rejects stale updates without losing either task', async () => {
  const auth = { owner: ownerA, token: tokenA };
  await Promise.all([
    createTask(auth, task('one'), 'one-key'),
    createTask(auth, task('two'), 'two-key'),
  ]);
  const copies = await Promise.all([
    createTask(auth, task('duplicate'), 'duplicate-key'),
    createTask(auth, task('unused'), 'duplicate-key'),
  ]);
  expect(copies[0].id).toBe(copies[1].id);
  const results = await Promise.allSettled([
    putTask(auth, { ...task('one'), title: 'Device 1' }, 1),
    putTask(auth, { ...task('one'), title: 'Device 2' }, 1),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  expect((await database().doc('users/studentA/tasks/two').get()).exists).toBe(
    true,
  );
});
it('keeps credentials encrypted and prevents stale disconnect restoration', async () => {
  const auth = { owner: ownerA, token: tokenA },
    conn = await connection(auth);
  conn.canvas = await seal({ token: 'canvas-secret' });
  await saveConnection(auth, conn);
  const data = (
    await database().doc('users/studentA/private/connections').get()
  ).data()!;
  expect(JSON.stringify(data)).not.toContain('canvas-secret');
  expect(data.token).toBeUndefined();
  expect(await unseal(data.canvas)).toEqual({ token: 'canvas-secret' });
  const stale = { ...conn };
  conn.canvas = null;
  await saveConnection(auth, conn);
  await expect(saveConnection(auth, stale)).rejects.toMatchObject({
    status: 409,
  });
  expect((await connection(auth)).canvas).toBeNull();
  expect(await getDocument(auth, 'users/studentA/settings/canvas')).toBeNull();
});
it('restricts calendar publishing and keeps timetables private', async () => {
  process.env.SCHOOL_CALENDAR_ADMIN_UID = ownerA;
  const read = await calendarApi.GET(req('school-calendar', tokenA)),
    payload = await read.json();
  expect(payload.calendar.dates).toHaveLength(334);
  expect(
    (
      await calendarApi.PUT(
        req('school-calendar', tokenB, 'PUT', payload.calendar),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await calendarApi.PUT(
        req('school-calendar', tokenA, 'PUT', payload.calendar),
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await calendarApi.PUT(
        req('school-calendar', tokenA, 'PUT', payload.calendar),
      )
    ).status,
  ).toBe(409);
  const details = {
    name: 'Physics',
    cycle: 'A',
    startTime: '07:45',
    endTime: '09:15',
    termStart: '2026-08-19',
    termEnd: '2027-06-10',
  };
  expect(
    (
      await timetableApi.POST(
        req('timetable', tokenA, 'POST', details, 'physics-key'),
      )
    ).status,
  ).toBe(201);
  expect(
    (await timetableApi.GET(req('timetable', tokenB)).then((r) => r.json()))
      .classes,
  ).toHaveLength(0);
});
it('binds OAuth state, checks permissions and rejects callback replay', async () => {
  const start = await googleStart.POST(req('google/start', tokenA, 'POST', {})),
    payload = await start.json(),
    url = new URL(payload.url),
    cookie = start.headers.get('set-cookie')!.split(';')[0];
  expect(url.searchParams.get('client_id')).toBe(
    'test.apps.googleusercontent.com',
  );
  expect(url.searchParams.get('code_challenge')).toBeTruthy();
  expect(new Set(url.searchParams.get('scope')!.split(' '))).toEqual(
    new Set([
      'https://www.googleapis.com/auth/calendar.app.created',
      'https://www.googleapis.com/auth/calendar.events.owned.readonly',
    ]),
  );
  const savedFetch = globalThis.fetch;
  const network = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input, init) => {
      if (
        (input instanceof Request ? input.url : input.toString()) ===
        'https://oauth2.googleapis.com/token'
      )
        return Response.json({
          refresh_token: 'refresh-secret',
          scope:
            'https://www.googleapis.com/auth/calendar.app.created https://www.googleapis.com/auth/calendar.events.owned.readonly',
        });
      return savedFetch(input, init);
    });
  const callback = () =>
    new Request(
      'http://localhost:3000/api/google/return?state=' +
        url.searchParams.get('state') +
        '&code=code',
      { headers: { cookie } },
    );
  expect(await (await googleReturn.GET(callback())).text()).toContain(
    'connected',
  );
  expect(await (await googleReturn.GET(callback())).text()).toContain('error');
  network.mockRestore();
  const conn = await connection({ owner: ownerA, token: tokenA });
  expect(conn.google).toBeTruthy();
  expect(
    (await connection({ owner: ownerB, token: tokenB })).google,
  ).toBeNull();
});
it('resumes paginated Canvas sync, retains completed/undated items and never deletes on a partial failure', async () => {
  const auth = { owner: ownerA, token: tokenA },
    conn = await connection(auth);
  conn.canvas = await seal({ token: 'canvas-secret' });
  await saveConnection(auth, conn);
  const network = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.includes('/courses?'))
        return Response.json([
          { id: 1, name: 'Physics', course_code: 'Physics' },
        ]);
      if (url.includes('/assignments?'))
        return Response.json([
          { id: 1, name: 'No due date', due_at: null },
          { id: 2, name: 'Lab', due_at: '2026-10-09T02:00:00Z' },
        ]);
      throw new Error('Unexpected external request');
    });
  const statuses = [];
  for (let i = 0; i < 8; i++) {
    const r = await runSync(auth, 'canvas');
    statuses.push(r.status);
    if (r.status === 'done') break;
  }
  expect(statuses).toContain('pending');
  expect(statuses.at(-1)).toBe('done');
  const rows = await database()
    .collection('users/studentA/tasks')
    .where('source', '==', 'canvas')
    .get();
  expect(rows.size).toBe(2);
  expect(rows.docs.some((d) => d.data().date === null)).toBe(true);
  expect(rows.docs.some((d) => d.data().date === '2026-10-08')).toBe(true);
  network.mockRestore();
});
it('exports no credentials and deletion blocks delayed writes', async () => {
  const response = await accountApi.GET(req('account', tokenA)),
    exported = await response.json();
  expect(exported.classes).toHaveLength(1);
  expect(JSON.stringify(exported)).not.toMatch(/canvas-secret|refresh-secret/);
  const b = { owner: ownerB, token: tokenB };
  await database().doc('users/studentB').set({ deleting: true });
  await expect(putTask(b, task('late'))).rejects.toMatchObject({ status: 403 });
  await expect(user(req('tasks', tokenB))).rejects.toMatchObject({
    status: 403,
  });
});
it('encrypts large, restartable migration backups and removes every legacy credential copy', async () => {
  const { migrateUser, migrationOwners } = await import('../../lib/migration');
  const uid = 'legacyStudent',
    legacyTasks = Array.from({ length: 25 }, (_, i) => ({
      ...task('legacy-' + i),
      notes: 'x'.repeat(10000),
    }));
  await database()
    .doc(`users/${uid}/settings/canvas`)
    .set({
      tasks: JSON.stringify(legacyTasks),
      token: 'legacy-plaintext-secret',
    });
  expect((await database().doc(`users/${uid}`).get()).exists).toBe(false);
  expect((await migrationOwners()).map((ref) => ref.id)).toContain(uid);
  const backups: string[] = [];
  expect(
    (
      await migrateUser(
        uid,
        async (value) => {
          backups.push(value);
        },
        false,
      )
    ).status,
  ).toBe('dry-run');
  expect(backups).toHaveLength(0);
  await expect(
    migrateUser(
      uid,
      async () => {
        throw new Error('Backup disk unavailable');
      },
      true,
    ),
  ).rejects.toThrow('Backup disk unavailable');
  expect((await database().doc(`users/${uid}`).get()).data()?.migrating).toBe(
    true,
  );
  const migrated = await migrateUser(
    uid,
    async (value) => {
      backups.push(value);
    },
    true,
  );
  expect(migrated.count).toBe(25);
  expect(backups[0]).not.toContain('legacy-plaintext-secret');
  const backup = await unseal<{ legacy: { token: string } }>(backups[0]);
  expect(backup.legacy.token).toBe('legacy-plaintext-secret');
  const legacy = (
    await database().doc(`users/${uid}/settings/canvas`).get()
  ).data();
  expect(legacy?.token).toBeUndefined();
  expect(legacy?.tasks).toBeUndefined();
  expect((await database().collection(`users/${uid}/tasks`).get()).size).toBe(
    25,
  );
  expect((await migrateUser(uid, async () => {}, true)).status).toBe(
    'already-migrated',
  );
});
it('migrates verified legacy workspaces privately and preserves completion through Canvas resync', async () => {
  const { migrateUser, migrationOwners } = await import('../../lib/migration');
  const uid = 'workspaceStudent',
    access = await token(uid);
  await database().doc(`workspaces/${uid}/assignments/old-canvas-id`).set({
    id: 'old-canvas-id',
    title: 'Original lab',
    dueDate: '2026-10-08',
    source: 'canvas',
    canvasId: '2',
    done: true,
    sourceUrl: 'https://ia.instructure.com/courses/1/assignments/2',
  });
  await database().doc(`workspaces/${uid}/assignments/manual`).set({
    id: 'manual',
    title: 'Essay',
    dueDate: '2026-10-09',
    done: true,
  });
  await database().doc(`workspaces/${uid}/classes/physics`).set({
    name: 'Physics',
    room: '101',
    teacher: 'Teacher',
    email: 'teacher@example.test',
  });
  await database()
    .doc(`users/${uid}/settings/duenext`)
    .set({
      canvas: await seal({ token: 'old-encrypted-canvas' }),
    });
  await database().doc('workspaces/unowned/assignments/private').set({
    id: 'private',
    title: 'Unowned archive',
    dueDate: '2026-10-09',
  });
  expect((await migrationOwners()).map((ref) => ref.id)).toContain(uid);
  expect((await migrationOwners()).map((ref) => ref.id)).not.toContain(
    'unowned',
  );
  expect((await migrateUser(uid, async () => {}, false)).count).toBe(2);
  const backups: string[] = [];
  expect(
    (
      await migrateUser(
        uid,
        async (value) => {
          backups.push(value);
        },
        true,
      )
    ).count,
  ).toBe(2);
  const snapshot = await unseal<{
    workspaceAssignments: unknown[];
    workspaceClasses: unknown[];
  }>(backups[0]);
  expect(snapshot.workspaceAssignments).toHaveLength(2);
  expect(snapshot.workspaceClasses).toHaveLength(1);
  expect(
    (await database().collection(`workspaces/${uid}/assignments`).get()).empty,
  ).toBe(true);
  expect(
    (await database().doc('workspaces/unowned/assignments/private').get())
      .exists,
  ).toBe(true);
  expect(
    (await database().doc(`users/${uid}/settings/duenext`).get()).data()
      ?.canvas,
  ).toBeUndefined();
  const exported = await (await accountApi.GET(req('account', access))).json();
  expect(exported.legacyClasses).toHaveLength(1);
  expect(JSON.stringify(exported)).not.toContain('old-encrypted-canvas');
  const otherExport = await (
    await accountApi.GET(req('account', tokenA))
  ).json();
  expect(otherExport.legacyClasses).toBeUndefined();
  const previousFetch = globalThis.fetch;
  const network = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input, init) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.startsWith('https://ia.instructure.com/api/v1/courses?'))
        return Response.json([{ id: 1, name: 'Physics' }]);
      if (
        url.startsWith(
          'https://ia.instructure.com/api/v1/courses/1/assignments?',
        )
      )
        return Response.json([
          { id: 2, name: 'Original lab', due_at: '2026-10-09T02:00:00Z' },
        ]);
      return previousFetch(input, init);
    });
  try {
    const auth = { owner: uid, token: access };
    let status = '';
    for (let i = 0; i < 8 && status !== 'done'; i++)
      status = (await runSync(auth, 'canvas')).status;
    expect(status).toBe('done');
    const migrated = await database().collection(`users/${uid}/tasks`).get();
    expect(migrated.size).toBe(2);
    expect(
      migrated.docs.find((doc) => doc.data().source === 'canvas')?.data().done,
    ).toBe(1);
    expect((await migrateUser(uid, async () => {}, true)).status).toBe(
      'already-migrated',
    );
  } finally {
    network.mockRestore();
  }
});
it('cancels a pending OAuth start across logout atomically', async () => {
  const logout = await import('../../app/api/oauth-session/route');
  const request = req('google/start', tokenA, 'POST', {});
  request.headers.set('X-Planner-Session', 'browser-before-logout');
  const start = await googleStart.POST(request),
    payload = await start.json(),
    state = new URL(payload.url).searchParams.get('state'),
    cookie = start.headers.get('set-cookie')!.split(';')[0];
  const out = req('oauth-session', tokenA, 'DELETE');
  out.headers.set('X-Planner-Session', 'browser-before-logout');
  expect((await logout.DELETE(out)).status).toBe(200);
  const after = req('google/start', tokenA, 'POST', {});
  after.headers.set('X-Planner-Session', 'browser-before-logout');
  expect((await googleStart.POST(after)).status).toBe(401);
  const callback = new Request(
    `http://localhost:3000/api/google/return?state=${state}&code=code`,
    { headers: { cookie } },
  );
  expect(await (await googleReturn.GET(callback)).text()).toContain('error');
});
it('blocks a Google mutation when disconnected while the remote GET is pending', async () => {
  const uid = 'syncCancellation',
    auth = { owner: uid, token: '' };
  await database().doc(`users/${uid}/tasks/a-event`).set(task('a-event'));
  const conn = await connection(auth);
  conn.google = await seal({
    refresh: 'refresh',
    calendar: 'private-calendar',
  });
  await saveConnection(auth, conn);
  let release!: (value: Response) => void;
  const mutations: string[] = [];
  const original = globalThis.fetch;
  const network = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input, init) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url === 'https://oauth2.googleapis.com/token')
        return Response.json({ access_token: 'access' });
      if (url.includes('/calendar/v3/')) {
        if (!init?.method || init.method === 'GET')
          return new Promise((resolve) => {
            release = resolve;
          });
        mutations.push(init.method);
        return Response.json({ updated: new Date().toISOString() });
      }
      return original(input, init);
    });
  const pending = runSync(auth, 'google');
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  const disconnected = await connection(auth);
  disconnected.google = null;
  await saveConnection(auth, disconnected);
  release(new Response(null, { status: 404 }));
  expect((await pending).status).toBe('error');
  expect(mutations).toEqual([]);
  expect((await connection(auth)).google).toBeNull();
  network.mockRestore();
});
it('quarantines unowned browser records without assigning them to the current student', async () => {
  const quarantine = await import('../../app/api/recovery/quarantine/route'),
    recover = await import('../../app/api/recovery/route');
  const original = task('unowned-browser-item');
  const result = await quarantine.POST(
    req('recovery/quarantine', tokenA, 'POST', { tasks: [original] }),
  );
  const payload = await result.json();
  expect(payload.sealed).not.toContain('Essay');
  expect(
    (await database().doc('users/studentA/tasks/unowned-browser-item').get())
      .exists,
  ).toBe(false);
  process.env.LEGACY_PERSONAL_OWNER_UID = 'the-original-owner';
  expect(
    (await recover.POST(req('recovery', tokenA, 'POST', payload))).status,
  ).toBe(403);
  delete process.env.LEGACY_PERSONAL_OWNER_UID;
});
it('deletes student data and rejects revoked and disabled identities', async () => {
  const uid = 'deleteStudent',
    tokenC = await token(uid),
    auth = { owner: uid, token: tokenC };
  await createTask(auth, task('erase-me'), 'erase-me-key');
  await database()
    .doc(`users/${uid}`)
    .set({ displayName: 'Private legacy profile', migrating: true });
  const removed = await accountApi.DELETE(
    req('account', tokenC, 'DELETE', { confirm: 'DELETE' }),
  );
  expect(removed.status).toBe(200);
  expect((await database().collection(`users/${uid}/tasks`).get()).empty).toBe(
    true,
  );
  expect((await database().doc(`users/${uid}`).get()).data()?.deleting).toBe(
    true,
  );
  expect(
    (await database().doc(`users/${uid}`).get()).data()?.displayName,
  ).toBeUndefined();
  await expect(user(req('tasks', tokenC))).rejects.toMatchObject({
    status: 401,
  });
  const uidD = 'disabledStudent',
    tokenD = await token(uidD);
  await adminAuth().updateUser(uidD, { disabled: true });
  await expect(user(req('tasks', tokenD))).rejects.toMatchObject({
    status: 401,
  });
});
it('offers only the current student’s Canvas courses for their A/B timetable', async () => {
  const coursesApi = await import('../../app/api/courses/route'),
    { createHash } = await import('node:crypto');
  const conn = await connection({ owner: ownerA, token: tokenA });
  const fingerprint = createHash('sha256').update(conn.canvas!).digest('hex');
  await database()
    .doc('users/studentA/syncJobs/canvas')
    .set(
      {
        credentialFingerprint: fingerprint,
        state: {
          phase: 'assignments',
          courses: [{ id: 101, name: 'IB Physics', course_code: 'Physics' }],
        },
      },
      { merge: true },
    );
  const mine = await coursesApi.GET(req('courses', tokenA));
  expect((await mine.json()).courses).toEqual([
    { id: '101', name: 'IB Physics', code: 'Physics' },
  ]);
  const otherToken = await token('courseStudentB');
  const other = await coursesApi.GET(req('courses', otherToken));
  expect((await other.json()).courses).toEqual([]);
  const details = {
    name: 'IB Physics',
    canvasCourseId: '101',
    cycle: 'B',
    startTime: '09:30',
    endTime: '11:00',
    termStart: '2026-08-19',
    termEnd: '2027-06-10',
  };
  const saved = await timetableApi.POST(
    req('timetable', tokenA, 'POST', details, 'canvas-physics-class'),
  );
  expect(saved.status).toBe(201);
  expect((await saved.json()).item.canvasCourseId).toBe('101');
  conn.canvas = await seal({ token: 'replacement-canvas-account' });
  await saveConnection({ owner: ownerA, token: tokenA }, conn);
  const replaced = await coursesApi.GET(req('courses', tokenA));
  expect((await replaced.json()).courses).toEqual([]);
});
it('keeps provider completion metadata when the other connection is changed', async () => {
  const auth = { owner: 'metadataStudent', token: '' },
    conn = await connection(auth);
  conn.canvas = await seal({ token: 'canvas' });
  await saveConnection(auth, conn);
  const old = await connection(auth);
  await database()
    .doc('users/metadataStudent/private/connections')
    .update({ last_canvas: '2026-10-08T12:00:00Z' });
  old.google = await seal({ refresh: 'google' });
  await saveConnection(auth, old);
  expect((await connection(auth)).last_canvas).toBe('2026-10-08T12:00:00Z');
});
it('does not restart Canvas when only the Google credentials change', async () => {
  const uid = 'providerIndependence',
    auth = { owner: uid, token: '' },
    conn = await connection(auth);
  conn.canvas = await seal({ token: 'canvas' });
  await saveConnection(auth, conn);
  const network = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () =>
      Response.json([{ id: 1, name: 'Physics', course_code: 'Physics' }]),
    );
  expect((await runSync(auth, 'canvas')).status).toBe('pending');
  const updated = await connection(auth);
  updated.google = await seal({ refresh: 'google' });
  await saveConnection(auth, updated, 'google');
  network.mockImplementation(async () => Response.json([]));
  expect((await runSync(auth, 'canvas')).status).toBe('pending');
  expect(
    (await database().doc(`users/${uid}/syncJobs/canvas`).get()).data()?.state
      .index,
  ).toBe(1);
  network.mockRestore();
});
it('preserves a local edit made while Google is saving an older revision', async () => {
  const uid = 'concurrentGoogleEdit',
    auth = { owner: uid, token: '' },
    ref = database().doc(`users/${uid}/tasks/local-event`);
  await ref.set({
    ...task('local-event', 'First edit'),
    googleId: 'existing-event',
  });
  const conn = await connection(auth);
  conn.google = await seal({ refresh: 'google', calendar: 'private-calendar' });
  await saveConnection(auth, conn);
  let release!: (value: Response) => void;
  let remote = {
    id: 'existing-event',
    summary: 'Old plan',
    updated: '2000-01-01T00:00:00Z',
    etag: 'etag-1',
    start: { date: '2026-10-09' },
    end: { date: '2026-10-10' },
  };
  const sent: string[] = [];
  const original = globalThis.fetch,
    network = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input, init) => {
        const url = input instanceof Request ? input.url : input.toString();
        if (url === 'https://oauth2.googleapis.com/token')
          return Response.json({ access_token: 'google-access' });
        if (url.includes('/calendar/v3/')) {
          if (init?.method === 'PUT') {
            const body = JSON.parse(
              typeof init.body === 'string' ? init.body : '{}',
            ) as { summary: string };
            sent.push(body.summary);
            remote = {
              ...remote,
              summary: body.summary,
              updated:
                sent.length === 1
                  ? '2099-01-01T00:00:00Z'
                  : '2099-01-02T00:00:00Z',
            };
            if (sent.length === 1)
              return new Promise((resolve) => {
                release = resolve;
              });
            return Response.json(remote);
          }
          return Response.json(remote);
        }
        return original(input, init);
      });
  const pending = runSync(auth, 'google');
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  const current = (await ref.get()).data() as Task;
  await putTask(
    auth,
    { ...current, title: 'Second edit', updated: new Date().toISOString() },
    current.revision,
  );
  release(Response.json(remote));
  expect((await pending).status).toBe('error');
  expect((await ref.get()).data()?.title).toBe('Second edit');
  expect((await ref.get()).data()?.googlePendingUpdated).toBe(remote.updated);
  await runSync(auth, 'google');
  expect(sent).toEqual(['First edit', 'Second edit']);
  expect((await ref.get()).data()?.title).toBe('Second edit');
  expect((await ref.get()).data()?.googlePendingUpdated).toBeUndefined();
  network.mockRestore();
});
