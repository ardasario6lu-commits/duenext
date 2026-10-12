import { database } from '@/lib/admin';
import { legacyTaskId } from '@/lib/migration';
import {
  active,
  cleanTask,
  failure,
  guard,
  HttpError,
  json,
  rateLimit,
  readBody,
  unseal,
  user,
} from '@/lib/server';
import { validateTask, type Task } from '@/lib/types';
export async function GET(req: Request) {
  try {
    const auth = await user(req);
    return json({
      allowed:
        !!process.env.LEGACY_PERSONAL_OWNER_UID &&
        auth.owner === process.env.LEGACY_PERSONAL_OWNER_UID,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    guard(req);
    const auth = await user(req);
    if (
      !process.env.LEGACY_PERSONAL_OWNER_UID ||
      auth.owner !== process.env.LEGACY_PERSONAL_OWNER_UID
    )
      throw new HttpError(
        'Only the original planner owner can review legacy browser data.',
        403,
      );
    await rateLimit(auth, 'legacy-recovery', 5, 3600000);
    const raw = await readBody(req, 1500000);
    if (typeof raw.sealed !== 'string')
      throw new HttpError('Choose the original browser backup.');
    const backup = await unseal<{
      format: string;
      tasks: Record<string, unknown>[];
    }>(raw.sealed);
    if (
      backup.format !== 'legacy-browser-v1' ||
      !Array.isArray(backup.tasks) ||
      backup.tasks.length > 5000
    )
      throw new HttpError('Invalid browser backup.');
    const tasks: Task[] = backup.tasks.map((t) => ({
      id: legacyTaskId(auth.owner, t),
      ...validateTask(t),
      source: 'manual',
      sourceUrl: '',
      deleted: 0,
      revision: 1,
      updated: new Date().toISOString(),
    }));
    for (let offset = 0; offset < tasks.length; offset += 100) {
      const chunk = tasks.slice(offset, offset + 100),
        refs = chunk.map((t) =>
          database().doc(`users/${auth.owner}/tasks/${t.id}`),
        );
      await database().runTransaction(async (tx) => {
        await active(tx, auth);
        const docs = await tx.getAll(...refs);
        chunk.forEach((task, i) => {
          if (!docs[i].exists) tx.create(refs[i], cleanTask(task));
        });
      });
    }
    return json({ ok: true, count: tasks.length });
  } catch (e) {
    return failure(e);
  }
}
