'use client';
import { initializeApp, getApps } from 'firebase/app';
import {
  browserLocalPersistence,
  browserSessionPersistence,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  connectAuthEmulator,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from 'firebase/auth';
const app =
  getApps()[0] ||
  initializeApp({
    apiKey:
      process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||
      'demo-api-key',
    authDomain:
      process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ||
      'demo-duenext.firebaseapp.com',
    projectId:
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'demo-duenext',
    appId:
      process.env.NEXT_PUBLIC_FIREBASE_APP_ID ||
      '1:000000000000:web:demo-duenext',
  });
export const auth = getAuth(app);
if (
  process.env.NODE_ENV !== 'production' &&
  process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL
)
  connectAuthEmulator(
    auth,
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL,
    { disableWarnings: true },
  );
if (typeof window !== 'undefined') {
  try {
    localStorage.removeItem('duenext.connection.v1');
  } catch {
    /* Storage may be disabled. */
  }
}
const pending = new Set<AbortController>();
let sessionId = '';
function browserSession(uid: string) {
  if (typeof window !== 'undefined') {
    try {
      const saved = JSON.parse(
        sessionStorage.getItem('duenext.session.v2') || 'null',
      ) as { uid: string; id: string } | null;
      if (saved?.uid === uid) return saved.id;
      const id = crypto.randomUUID();
      sessionStorage.setItem('duenext.session.v2', JSON.stringify({ uid, id }));
      return id;
    } catch {
      /* A memory-only session works when storage is unavailable. */
    }
  }
  return crypto.randomUUID();
}
let generation = 0,
  owner: string | null = null;
onAuthStateChanged(auth, (next) => {
  if (next?.uid !== owner) {
    owner = next?.uid || null;
    sessionId = next ? browserSession(next.uid) : '';
    generation++;
    for (const controller of pending) controller.abort();
    pending.clear();
  }
});
export async function signIn(remember = false) {
  await setPersistence(
    auth,
    remember ? browserLocalPersistence : browserSessionPersistence,
  );
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    return await signInWithPopup(auth, provider);
  } catch (e) {
    if (
      e &&
      typeof e === 'object' &&
      'code' in e &&
      e.code === 'auth/popup-blocked'
    )
      return signInWithRedirect(auth, provider);
    throw e;
  }
}
export async function signOutUser() {
  try {
    await authFetch('/api/oauth-session', { method: 'DELETE' });
  } catch {
    /* Local sign-out still proceeds during an outage. */
  }
  generation++;
  for (const controller of pending) controller.abort();
  pending.clear();
  // Legacy credentials have no ownership proof and must never be recovered into another account.
  try {
    localStorage.removeItem('duenext.connection.v1');
    sessionStorage.removeItem('duenext.session.v2');
  } catch {
    /* Storage may be disabled. */
  }
  return signOut(auth);
}
export async function authFetch(
  path: string,
  init: RequestInit = {},
  expectedOwner = auth.currentUser?.uid,
) {
  const current = auth.currentUser,
    epoch = generation;
  if (!current) throw new Error('Sign in with Google to continue.');
  if (current.uid !== expectedOwner)
    throw new DOMException('Account changed.', 'AbortError');
  const controller = new AbortController();
  pending.add(controller);
  const externalAbort = () => controller.abort();
  init.signal?.addEventListener('abort', externalAbort, { once: true });
  try {
    const token = await current.getIdToken();
    if (auth.currentUser?.uid !== current.uid || epoch !== generation)
      throw new DOMException('Account changed.', 'AbortError');
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    headers.set('X-Planner-Session', sessionId);
    const response = await fetch(path, {
      ...init,
      headers,
      signal: controller.signal,
    });
    // Consume the body before releasing cancellation so a late body cannot reach another account.
    const bytes = await response.arrayBuffer();
    if (
      auth.currentUser?.uid !== current.uid ||
      epoch !== generation ||
      controller.signal.aborted
    )
      throw new DOMException('Account changed.', 'AbortError');
    return new Response(bytes, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } finally {
    pending.delete(controller);
    init.signal?.removeEventListener('abort', externalAbort);
  }
}
export async function quarantineLegacyTasks(expectedOwner: string) {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem('duenext.tasks.v1');
  } catch {
    return;
  }
  if (!raw) return;
  let tasks: unknown;
  try {
    tasks = JSON.parse(raw);
  } catch {
    throw new Error(
      'The original browser planner needs manual recovery before this browser can be shared.',
    );
  }
  const response = await authFetch(
    '/api/recovery/quarantine',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tasks }),
    },
    expectedOwner,
  );
  const result = (await response.json()) as { sealed?: string; error?: string };
  if (!response.ok || !result.sealed)
    throw new Error(result.error || 'The browser data upgrade did not finish.');
  if (auth.currentUser?.uid !== expectedOwner)
    throw new DOMException('Account changed.', 'AbortError');
  if (localStorage.getItem('duenext.tasks.v1') !== raw)
    throw new Error('Legacy browser data changed. Retry its upgrade.');
  localStorage.setItem('duenext.legacy-quarantine.v2', result.sealed);
  localStorage.removeItem('duenext.tasks.v1');
}
