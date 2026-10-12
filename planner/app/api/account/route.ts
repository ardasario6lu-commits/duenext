import { adminAuth, database } from '@/lib/admin';
import {
  connection,
  failure,
  rateLimit,
  guard,
  HttpError,
  json,
  listTasks,
  readBody,
  recentAuth,
  unseal,
  user,
  boundedFetch,
} from '@/lib/server';
export async function GET(req: Request) {
  try {
    const auth = await user(req);
    await rateLimit(auth, 'exports', 5, 3600000);
    const classes = await database()
      .collection(`users/${auth.owner}/classes`)
      .get();
    const legacyClasses = await database()
      .doc(`users/${auth.owner}/private/legacy-classes`)
      .get();
    return json(
      {
        formatVersion: 1,
        exportedAt: new Date().toISOString(),
        tasks: await listTasks(auth),
        classes: classes.docs.map((d) => d.data()),
        ...(legacyClasses.exists
          ? { legacyClasses: legacyClasses.data()?.classes || [] }
          : {}),
      },
      {
        headers: {
          'Content-Disposition': 'attachment; filename="duenext-export.json"',
        },
      },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function DELETE(req: Request) {
  try {
    guard(req);
    const auth = await user(req, true);
    recentAuth(auth);
    const raw = await readBody(req);
    if (raw.confirm !== 'DELETE')
      throw new HttpError('Type DELETE to confirm account deletion.');
    const conn = await connection(auth);
    let refresh: { refresh?: string } | null = null;
    try {
      refresh = conn.google
        ? await unseal<{ refresh?: string }>(conn.google)
        : null;
    } catch {
      /* Corrupt credentials must not prevent data deletion. */
    }
    await database()
      .doc(`users/${auth.owner}`)
      .set({ deleting: true, deletedAt: new Date().toISOString() });
    await adminAuth().revokeRefreshTokens(auth.owner);
    let revoked = true;
    if (refresh?.refresh) {
      try {
        revoked = (
          await boundedFetch('https://oauth2.googleapis.com/revoke', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token: refresh.refresh }),
          })
        ).ok;
      } catch {
        revoked = false;
      }
    }
    // Delete children, keeping a tombstone so in-flight writes cannot resurrect this account.
    const collections = await database()
      .doc(`users/${auth.owner}`)
      .listCollections();
    for (const collection of collections)
      await database().recursiveDelete(collection);
    await adminAuth().deleteUser(auth.owner);
    return json({ ok: true, revoked });
  } catch (e) {
    return failure(e);
  }
}
