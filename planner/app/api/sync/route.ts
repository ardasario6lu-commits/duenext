import {
  connection,
  failure,
  guard,
  HttpError,
  json,
  rateLimit,
  readBody,
  user,
} from '@/lib/server';
import { runSync } from '@/lib/sync-jobs';
export const maxDuration = 60;
export async function POST(req: Request) {
  try {
    guard(req);
    const auth = await user(req),
      raw = await readBody(req);
    if (
      raw.provider !== undefined &&
      raw.provider !== 'canvas' &&
      raw.provider !== 'google'
    )
      throw new HttpError('Choose a calendar provider.');
    if (raw.timeZone !== undefined && raw.timeZone !== 'America/Detroit')
      throw new HttpError('Use the school time zone, America/Detroit.');
    if (raw.force !== undefined && typeof raw.force !== 'boolean')
      throw new HttpError('Invalid sync request.');
    await rateLimit(auth, 'sync-requests', 120);
    const conn = await connection(auth),
      providers = raw.provider
        ? [raw.provider as 'canvas' | 'google']
        : (['canvas', 'google'] as const),
      jobs = [];
    for (const provider of providers) {
      if (conn[provider])
        jobs.push(await runSync(auth, provider, raw.force === true));
    }
    return json({
      jobs,
      canvas: jobs.find((j) => j.provider === 'canvas')?.count || 0,
      google: jobs.find((j) => j.provider === 'google')?.count || 0,
      busy: jobs.some((j) => j.status === 'busy'),
      errors: jobs.flatMap((j) => ('error' in j && j.error ? [j.error] : [])),
    });
  } catch (e) {
    return failure(e);
  }
}
