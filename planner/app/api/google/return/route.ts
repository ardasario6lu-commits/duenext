import { createHash } from 'node:crypto';
import {
  active,
  appOrigin,
  boundedFetch,
  connection,
  googleConfig,
  HttpError,
  identifier,
  saveConnection,
  seal,
  unseal,
  user,
} from '@/lib/server';
import { database } from '@/lib/admin';
function complete(origin: string, result: 'connected' | 'error') {
  const nonce = Buffer.from(
    crypto.getRandomValues(new Uint8Array(18)),
  ).toString('base64');
  const html = `<!doctype html><meta charset="utf-8"><title>Google Calendar</title><p>You can close this window.</p><script nonce="${nonce}">const message=${JSON.stringify({ type: 'duenext-google', result })}; if(window.opener&&!window.opener.closed){window.opener.postMessage(message,${JSON.stringify(origin)});window.close();}else{location.replace(${JSON.stringify(origin + '/?google=' + result)});}</script>`;
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`,
      'Set-Cookie':
        'duenext_google=; HttpOnly; Path=/api/google/return; Max-Age=0; SameSite=Lax; Secure',
    },
  });
}
export async function GET(req: Request) {
  let origin: string;
  try {
    origin = appOrigin(req);
  } catch {
    return new Response('Calendar configuration unavailable.', { status: 503 });
  }
  try {
    const config = googleConfig(),
      match = req.headers
        .get('cookie')
        ?.match(/(?:^|;\s*)duenext_google=([^;]+)/);
    if (!match) throw new HttpError('Missing authorization session.');
    const cookie = await unseal<{
        owner: string;
        state: string;
        expires: number;
      }>(decodeURIComponent(match[1])),
      query = new URL(req.url).searchParams;
    if (
      cookie.expires < Date.now() ||
      query.get('state') !== cookie.state ||
      !query.get('code') ||
      query.get('error')
    )
      throw new HttpError('Authorization cancelled.');
    const ref = database().doc(
      `users/${identifier(cookie.owner)}/oauth/${identifier(cookie.state)}`,
    );
    const session = await database().runTransaction(async (tx) => {
      const doc = await tx.get(ref),
        saved = doc.data();
      if (
        !saved ||
        saved.used ||
        Number(saved.expires) < Date.now() ||
        saved.stateHash !==
          createHash('sha256').update(cookie.state).digest('hex')
      )
        throw new HttpError('Authorization expired.');
      const profile = await active(tx, {
        owner: cookie.owner,
        token: '',
        ...(typeof saved.browserSession === 'string'
          ? { browserSession: saved.browserSession }
          : {}),
      });
      if (
        Number(saved.generation || 0) !== Number(profile?.oauthGeneration || 0)
      )
        throw new HttpError('Authorization session ended.');
      tx.update(ref, { used: true });
      return saved;
    });
    const token = await unseal<string>(String(session.token)),
      auth = await user(
        new Request(req.url, {
          headers: {
            Authorization: `Bearer ${token}`,
            ...(typeof session.browserSession === 'string'
              ? { 'X-Planner-Session': session.browserSession }
              : {}),
          },
        }),
      );
    if (auth.owner !== cookie.owner)
      throw new HttpError('Authorization account mismatch.');
    const conn = await connection(auth);
    if (conn.revision !== Number(session.connectionRevision))
      throw new HttpError('Your connection changed. Start again.');
    const response = await boundedFetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: query.get('code')!,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: origin + '/api/google/return',
        grant_type: 'authorization_code',
        code_verifier: await unseal<string>(String(session.verifier)),
      }),
    });
    const result = (await response.json()) as {
      refresh_token?: string;
      scope?: string;
    };
    const scopes = new Set((result.scope || '').split(' '));
    if (
      !response.ok ||
      !result.refresh_token ||
      !scopes.has('https://www.googleapis.com/auth/calendar.app.created') ||
      !scopes.has('https://www.googleapis.com/auth/calendar.events.owned.readonly')
    )
      throw new HttpError(
        'Grant both requested calendar permissions to connect.',
      );
    const oldGoogle = conn.google
      ? await unseal<{ calendar?: string }>(conn.google)
      : null;
    auth.oauth = cookie.state;
    conn.google = await seal({
      refresh: result.refresh_token,
      ...(oldGoogle?.calendar ? { calendar: oldGoogle.calendar } : {}),
    });
    conn.last_google = null;
    await saveConnection(auth, conn, 'google');
    await ref.delete();
    return complete(origin, 'connected');
  } catch {
    console.error('Google authorization rejected');
    return complete(origin, 'error');
  }
}
