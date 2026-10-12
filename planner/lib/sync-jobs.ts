import 'server-only';
import { createHash } from 'node:crypto';
import { database } from './admin';
import { active, HttpError, type AuthContext } from './server';
import { syncStep, type Provider, type SyncJob } from './sync';
export async function runSync(
  auth: AuthContext,
  provider: Provider,
  force = false,
) {
  const ref = database().doc(`users/${auth.owner}/syncJobs/${provider}`),
    lease = crypto.randomUUID(),
    now = Date.now();
  const claimed = await database().runTransaction(async (tx) => {
    await active(tx, auth);
    const [oldDoc, connDoc] = await tx.getAll(
        ref,
        database().doc(`users/${auth.owner}/private/connections`),
      ),
      old = oldDoc.data() as SyncJob | undefined,
      conn = connDoc.data();
    if (!conn?.[provider]) return null;
    if (old?.leaseUntil && old.leaseUntil > now)
      return { ...old, status: 'busy' as const };
    const fingerprint = createHash('sha256')
      .update(String(conn[provider]))
      .digest('hex');
    if (
      old?.status === 'done' &&
      old.credentialFingerprint === fingerprint &&
      !force &&
      Number(old.completedAt) > now - 300000
    )
      return old;
    const resume =
      old && old.status !== 'done' && old.credentialFingerprint === fingerprint;
    const limitRef = database().doc(`users/${auth.owner}/limits/sync-starts`);
    const counter = (await tx.get(limitRef)).data();
    const fresh = !counter || Number(counter.until) <= now;
    if (!resume && !fresh && Number(counter.count) >= 2)
      throw new HttpError(
        'Please wait a minute before starting another sync.',
        429,
      );
    if (!resume)
      tx.set(limitRef, {
        count: (fresh ? 0 : Number(counter?.count)) + 1,
        until: fresh ? now + 60000 : counter?.until,
      });
    const job: SyncJob = resume
      ? { ...old, lease, leaseUntil: now + 90000, status: 'pending' }
      : {
          provider,
          jobId: crypto.randomUUID(),
          status: 'pending',
          count: 0,
          connectionRevision: Number(conn.revision),
          credentialFingerprint: createHash('sha256')
            .update(String(conn[provider]))
            .digest('hex'),
          state: {
            phase: provider === 'canvas' ? 'courses' : 'outbound',
            cursor: '',
            index: 0,
            courses: [],
            seen: [],
            from: new Date(now - 30 * 86400000).toISOString(),
            to: new Date(now + 730 * 86400000).toISOString(),
          },
          lease,
          leaseUntil: now + 90000,
        };
    job.state.seen ||= [];
    tx.set(ref, job);
    return job;
  });
  if (!claimed) return { provider, status: 'disconnected', count: 0 };
  if (claimed.status === 'busy' || claimed.status === 'done')
    return { provider, status: claimed.status, count: claimed.count };
  const job = claimed,
    context: AuthContext = {
      ...auth,
      sync: { provider, lease, connectionRevision: job.connectionRevision },
    };
  let error: string | undefined;
  try {
    await syncStep(context, job);
    if (job.status === 'done') {
      await database().runTransaction(async (tx) => {
        await active(tx, context);
        tx.update(database().doc(`users/${auth.owner}/private/connections`), {
          [provider === 'canvas' ? 'last_canvas' : 'last_google']:
            new Date().toISOString(),
        });
      });
      job.completedAt = Date.now();
    }
  } catch (e) {
    job.status = 'error';
    error =
      e instanceof HttpError
        ? e.message
        : 'Sync could not finish. Your saved items are unchanged; retry to resume.';
  }
  // A provider/disconnect/account change invalidates the lease. Never let an old worker overwrite its replacement.
  await database()
    .runTransaction(async (tx) => {
      await active(tx, context);
      const saved = (await tx.get(ref)).data();
      if (saved?.lease !== lease)
        throw new HttpError('Sync was cancelled.', 409);
      tx.set(ref, {
        ...job,
        connectionRevision: context.sync!.connectionRevision,
        credentialFingerprint: String(saved.credentialFingerprint),
        lease: '',
        leaseUntil: 0,
      });
    })
    .catch(() => {
      error = 'Your connection changed. Start sync again.';
      job.status = 'error';
    });
  return {
    provider,
    status: job.status,
    count: job.count,
    ...(error ? { error } : {}),
  };
}
