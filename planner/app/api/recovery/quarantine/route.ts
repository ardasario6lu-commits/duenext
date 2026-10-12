import {
  failure,
  guard,
  HttpError,
  json,
  rateLimit,
  readBody,
  seal,
  user,
} from '@/lib/server';
export async function POST(req: Request) {
  try {
    guard(req);
    const auth = await user(req);
    await rateLimit(auth, 'legacy-recovery', 5, 3600000);
    const raw = await readBody(req, 1000000);
    if (!Array.isArray(raw.tasks) || raw.tasks.length > 5000)
      throw new HttpError('Legacy data needs manual recovery.');
    // No ownership is inferred and nothing is imported or retained on the server.
    return json({
      sealed: await seal({ format: 'legacy-browser-v1', tasks: raw.tasks }),
    });
  } catch (e) {
    return failure(e);
  }
}
