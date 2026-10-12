import seed from '@/data/school-calendar-2026-2027.json';
import { database } from '@/lib/admin';
import {
  active,
  failure,
  guard,
  HttpError,
  json,
  rateLimit,
  readBody,
  schoolAdmin,
  user,
} from '@/lib/server';
import { revision } from '@/lib/domain';
import { validateCalendar } from '@/lib/school';
export async function GET(req: Request) {
  try {
    const auth = await user(req);
    await rateLimit(auth, 'reads', 120);
    const doc = await database().doc('schoolCalendars/2026-2027').get();
    return json({
      calendar: validateCalendar(doc.data() || seed),
      admin: auth.owner === process.env.SCHOOL_CALENDAR_ADMIN_UID,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function PUT(req: Request) {
  try {
    guard(req);
    const auth = await user(req);
    schoolAdmin(auth);
    await rateLimit(auth, 'calendar', 10, 600000);
    const raw = await readBody(req, 300000),
      expected = revision(raw.revision),
      calendar = validateCalendar(raw),
      ref = database().doc('schoolCalendars/2026-2027');
    await database().runTransaction(async (tx) => {
      await active(tx, auth);
      const old = await tx.get(ref);
      if ((old.data()?.revision || 1) !== expected)
        throw new HttpError(
          'The school calendar changed. Reload before publishing.',
          409,
        );
      tx.set(ref, {
        ...calendar,
        revision: expected + 1,
        verifiedAt: new Date().toISOString(),
      });
    });
    return json({ ok: true, revision: expected + 1 });
  } catch (e) {
    return failure(e);
  }
}
