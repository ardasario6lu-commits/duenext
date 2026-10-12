import { beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({
  auth: {
    currentUser: null as null | {
      uid: string;
      getIdToken: () => Promise<string>;
    },
  },
  listeners: [] as ((user: { uid: string } | null) => void)[],
  setPersistence: vi.fn(),
  popup: vi.fn(),
  out: vi.fn(),
}));
vi.mock('firebase/app', () => ({
  getApps: () => [{}],
  initializeApp: () => ({}),
}));
vi.mock('firebase/auth', () => ({
  getAuth: () => fixture.auth,
  GoogleAuthProvider: class {
    setCustomParameters() {}
  },
  browserLocalPersistence: 'local',
  browserSessionPersistence: 'session',
  setPersistence: fixture.setPersistence,
  signInWithPopup: fixture.popup,
  signInWithRedirect: vi.fn(),
  signOut: fixture.out,
  connectAuthEmulator: vi.fn(),
  onAuthStateChanged: (
    _auth: unknown,
    listener: (user: { uid: string } | null) => void,
  ) => {
    fixture.listeners.push(listener);
    listener(fixture.auth.currentUser);
    return () => {};
  },
}));
function login(uid: string, getIdToken = async () => 'test-token') {
  fixture.auth.currentUser = { uid, getIdToken };
  for (const listener of fixture.listeners) listener(fixture.auth.currentUser);
}
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  fixture.listeners = [];
  fixture.auth.currentUser = null;
  vi.stubGlobal('localStorage', { removeItem: vi.fn() });
});
it('uses session persistence unless Remember me is selected', async () => {
  const client = await import('../../lib/firebase-client');
  await client.signIn();
  expect(fixture.setPersistence).toHaveBeenLastCalledWith(
    fixture.auth,
    'session',
  );
  await client.signIn(true);
  expect(fixture.setPersistence).toHaveBeenLastCalledWith(
    fixture.auth,
    'local',
  );
});
it('does not send a request when the account changes during token refresh', async () => {
  const client = await import('../../lib/firebase-client');
  let release!: (token: string) => void;
  login(
    'studentA',
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const network = vi.fn();
  vi.stubGlobal('fetch', network);
  const request = client.authFetch('/api/tasks', {}, 'studentA');
  login('studentB');
  release('old-token');
  await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  expect(network).not.toHaveBeenCalled();
});
it('aborts and rejects a late response body after account switching', async () => {
  const client = await import('../../lib/firebase-client');
  login('studentA');
  let release!: (bytes: ArrayBuffer) => void;
  const network = vi.fn(async () => ({
    arrayBuffer: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
    status: 200,
    statusText: 'OK',
    headers: new Headers(),
  }));
  vi.stubGlobal('fetch', network);
  const pending = client.authFetch('/api/tasks', {}, 'studentA');
  await vi.waitFor(() => expect(network).toHaveBeenCalled());
  login('studentB');
  release(new TextEncoder().encode('{"tasks":[]}').buffer);
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  await expect(
    client.authFetch('/api/tasks', {}, 'studentA'),
  ).rejects.toMatchObject({ name: 'AbortError' });
});
it('purges plaintext tokens and quarantines legacy tasks without importing them', async () => {
  const values = new Map([
    ['duenext.connection.v1', '{"canvas":"plaintext-token"}'],
    ['duenext.tasks.v1', '[{"id":"legacy","title":"Private legacy essay"}]'],
  ]);
  vi.stubGlobal('window', {});
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  vi.stubGlobal('sessionStorage', {
    getItem: () => null,
    setItem: vi.fn(),
    removeItem: vi.fn(),
  });
  const client = await import('../../lib/firebase-client');
  expect(values.has('duenext.connection.v1')).toBe(false);
  login('studentA');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ sealed: 'opaque-encrypted-data' })),
  );
  await client.quarantineLegacyTasks('studentA');
  expect(values.has('duenext.tasks.v1')).toBe(false);
  expect(values.get('duenext.legacy-quarantine.v2')).toBe(
    'opaque-encrypted-data',
  );
});
