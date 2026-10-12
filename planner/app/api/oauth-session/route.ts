import { database } from '@/lib/admin';
import { active, failure, guard, json, user } from '@/lib/server';
export async function DELETE(req: Request) {
  try {
    guard(req);
    const auth = await user(req);
    await database().runTransaction(async (tx) => {
      const profile = await active(tx, auth);
      tx.set(
        database().doc(`users/${auth.owner}`),
        { oauthGeneration: Number(profile?.oauthGeneration || 0) + 1 },
        { merge: true },
      );
      if (auth.browserSession)
        tx.set(
          database().doc(
            `users/${auth.owner}/browserSessions/${auth.browserSession}`,
          ),
          { revoked: true, revokedAt: Date.now() },
        );
    });
    return json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
