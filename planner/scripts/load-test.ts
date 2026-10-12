import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
if (
  process.env.FIREBASE_PROJECT_ID !== 'demo-duenext' ||
  process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099'
)
  throw new Error('Load tests are restricted to local demo emulators.');
const origin = process.env.LOAD_TEST_ORIGIN || 'http://localhost:3100';
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname))
  throw new Error('Load test origin must be local.');
const app = initializeApp({ projectId: 'demo-duenext' }, 'load-test'),
  auth = getAuth(app),
  db = getFirestore(app),
  tokens: string[] = [];
for (let offset = 0; offset < 400; offset += 20)
  await Promise.all(
    Array.from({ length: 20 }, async (_, i) => {
      const uid = 'loadStudent' + String(offset + i).padStart(3, '0');
      try {
        await auth.createUser({
          uid,
          email: uid + '@example.test',
          emailVerified: true,
        });
      } catch (e) {
        if ((e as { code?: string }).code !== 'auth/uid-already-exists')
          throw e;
      }
      const custom = await auth.createCustomToken(uid),
        r = await fetch(
          'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=demo-key',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: custom, returnSecureToken: true }),
          },
        );
      const data = (await r.json()) as { idToken: string };
      tokens[offset + i] = data.idToken;
      const batch = db.batch();
      for (let n = 0; n < 50; n++) {
        const id = 'task' + String(n).padStart(3, '0');
        batch.set(db.doc(`users/${uid}/tasks/${id}`), {
          id,
          title: 'Synthetic school assignment ' + n,
          category: 'school',
          kind: 'task',
          date: '2026-10-09',
          time: '',
          endTime: '',
          notes: 'Synthetic test fixture',
          course: 'Physics',
          priority: 'normal',
          done: 0,
          source: 'manual',
          sourceUrl: '',
          updated: '2026-10-08T12:00:00Z',
          deleted: 0,
          revision: 1,
        });
      }
      await batch.commit();
    }),
  );
const request = async (index: number) => {
  const start = performance.now(),
    r = await fetch(origin + '/api/tasks?limit=200', {
      headers: { Authorization: 'Bearer ' + tokens[index] },
    });
  if (!r.ok) throw new Error('Planner API returned ' + r.status);
  const data = (await r.json()) as { tasks: { title: string }[] };
  if (data.tasks.length !== 50)
    throw new Error('Incorrect account data returned');
  return performance.now() - start;
};
await request(0);
const timings = await Promise.all(
  Array.from({ length: 100 }, (_, i) => request(i)),
);
timings.sort((a, b) => a - b);
const report = {
  accounts: 400,
  assignmentsPerAccount: 50,
  concurrentStudents: 100,
  p50Ms: Math.round(timings[49]),
  p95Ms: Math.round(timings[94]),
  maxMs: Math.round(timings[99]),
  environment:
    'Local Next development server + Firebase emulators; not a production capacity certification',
};
console.log(JSON.stringify(report, null, 2));
if (report.p95Ms >= 2000) process.exitCode = 1;
