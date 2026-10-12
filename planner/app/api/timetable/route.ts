import { database } from '@/lib/admin';
import {
  active,
  failure,
  guard,
  identifier,
  HttpError,
  json,
  rateLimit,
  readBody,
  user,
} from '@/lib/server';
import { revision } from '@/lib/domain';
import { validateClass, type ClassBlock } from '@/lib/school';
export async function GET(req: Request) {
  try {
    const auth = await user(req);
    await rateLimit(auth, 'reads', 120);
    const rows = await database()
      .collection(`users/${auth.owner}/classes`)
      .limit(65)
      .get();
    return json({ classes: rows.docs.map((d) => ({ ...d.data(), id: d.id })) });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    guard(req);
    const auth = await user(req);
    await rateLimit(auth, 'writes');
    const value = validateClass(await readBody(req)),
      id = identifier(req.headers.get('idempotency-key')),
      ref = database().doc(`users/${auth.owner}/classes/${id}`);
    const item = await database().runTransaction(async (tx) => {
      await active(tx, auth);
      const existing = await tx.get(ref),
        all = await tx.get(
          database().collection(`users/${auth.owner}/classes`).limit(65),
        );
      if (existing.exists) {
        const old = existing.data() as ClassBlock;
        if (
          Object.entries(value).some(
            ([k, v]) => old[k as keyof ClassBlock] !== v,
          )
        )
          throw new HttpError('This save key was already used.', 409);
        return old;
      }
      if (all.size >= 64)
        throw new HttpError('A timetable can contain up to 64 class blocks.');
      const next = { ...value, id, revision: 1 };
      tx.create(ref, next);
      return next;
    });
    return json({ item }, { status: 201 });
  } catch (e) {
    return failure(e);
  }
}
export async function PATCH(req: Request) {
  try {
    guard(req);
    const auth = await user(req);
    await rateLimit(auth, 'writes');
    const raw = await readBody(req),
      id = identifier(raw.id),
      expected = revision(raw.revision),
      value = validateClass(raw),
      ref = database().doc(`users/${auth.owner}/classes/${id}`);
    const item = await database().runTransaction(async (tx) => {
      await active(tx, auth);
      const old = await tx.get(ref);
      if (!old.exists) throw new HttpError('Class not found.', 404);
      if (old.data()?.revision !== expected)
        throw new HttpError('This class changed. Reload before editing.', 409);
      const next = { ...value, id, revision: expected + 1 };
      tx.set(ref, next);
      return next;
    });
    return json({ item });
  } catch (e) {
    return failure(e);
  }
}
export async function DELETE(req: Request) {
  try {
    guard(req);
    const auth = await user(req);
    await rateLimit(auth, 'writes');
    const raw = await readBody(req),
      expected = revision(raw.revision),
      ref = database().doc(`users/${auth.owner}/classes/${identifier(raw.id)}`);
    await database().runTransaction(async (tx) => {
      await active(tx, auth);
      const old = await tx.get(ref);
      if (!old.exists) throw new HttpError('Class not found.', 404);
      if (old.data()?.revision !== expected)
        throw new HttpError('This class changed. Reload before deleting.', 409);
      tx.delete(ref);
    });
    return json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
