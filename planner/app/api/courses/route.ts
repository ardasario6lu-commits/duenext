import { createHash } from 'node:crypto';
import { database } from '@/lib/admin';
import { connection, failure, json, rateLimit, user } from '@/lib/server';
export async function GET(req: Request) {
  try {
    const auth = await user(req);
    await rateLimit(auth, 'reads', 120);
    const conn = await connection(auth);
    if (!conn.canvas)
      return json({ courses: [], connected: false, pending: false });
    const job = (
      await database().doc(`users/${auth.owner}/syncJobs/canvas`).get()
    ).data();
    const fingerprint = createHash('sha256').update(conn.canvas).digest('hex');
    if (!job || job.credentialFingerprint !== fingerprint)
      return json({ courses: [], connected: true, pending: true });
    const courses = (
      Array.isArray(job.state?.courses) ? job.state.courses : []
    ) as { id: number; name: string; course_code: string }[];
    return json({
      courses: courses.map((c) => ({
        id: String(c.id),
        name: c.name,
        code: c.course_code,
      })),
      connected: true,
      pending: job.state?.phase === 'courses',
    });
  } catch (e) {
    return failure(e);
  }
}
