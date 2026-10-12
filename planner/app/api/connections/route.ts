import {
  appOrigin,
  boundedFetch,
  connection,
  failure,
  googleConfig,
  guard,
  HttpError,
  json,
  rateLimit,
  readBody,
  saveConnection,
  seal,
  unseal,
  user,
} from '@/lib/server';
export async function GET(req: Request) {
  try {
    const auth = await user(req);
    await rateLimit(auth, 'reads', 120);
    const conn = await connection(auth);
    let configured = false;
    try {
      googleConfig();
      configured = true;
    } catch {
      /* Calendar remains optional. */
    }
    return json({
      canvas: !!conn.canvas,
      google: !!conn.google,
      googleConfigured: configured,
      lastCanvas: conn.last_canvas,
      lastGoogle: conn.last_google,
      origin: appOrigin(req),
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    guard(req);
    const auth = await user(req);
    await rateLimit(auth, 'connections', 10, 600000);
    const raw = await readBody(req),
      conn = await connection(auth);
    if (raw.provider !== 'canvas')
      throw new HttpError('Use Connect Google Calendar to authorize Google.');
    if (
      typeof raw.token !== 'string' ||
      raw.token.trim().length < 10 ||
      raw.token.length > 2000
    )
      throw new HttpError('Enter your Canvas access token.');
    const token = raw.token.trim(),
      r = await boundedFetch(
        'https://ia.instructure.com/api/v1/users/self/profile',
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
        },
      );
    if (!r.ok)
      throw new HttpError(
        r.status === 401 || r.status === 403
          ? 'Canvas rejected this token. Check its expiration and your school’s integration permissions.'
          : 'Canvas is unavailable. Try again.',
      );
    conn.canvas = await seal({ token });
    conn.last_canvas = null;
    await saveConnection(auth, conn, 'canvas');
    return json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
export async function DELETE(req: Request) {
  try {
    guard(req);
    const auth = await user(req);
    await rateLimit(auth, 'connections', 10, 600000);
    const raw = await readBody(req),
      conn = await connection(auth);
    if (raw.provider !== 'canvas' && raw.provider !== 'google')
      throw new HttpError('Choose a connection.');
    const google =
      raw.provider === 'google' && conn.google
        ? await unseal<{ refresh?: string }>(conn.google)
        : null;
    if (raw.provider === 'canvas') {
      conn.canvas = null;
      conn.last_canvas = null;
    } else {
      conn.google = null;
      conn.last_google = null;
    }
    await saveConnection(auth, conn, raw.provider);
    let revoked = true;
    if (google?.refresh) {
      try {
        const r = await boundedFetch('https://oauth2.googleapis.com/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: google.refresh }),
        });
        revoked = r.ok;
      } catch {
        revoked = false;
      }
    }
    return json({ ok: true, revoked });
  } catch (e) {
    return failure(e);
  }
}
