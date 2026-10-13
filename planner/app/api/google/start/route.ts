import { createHash } from 'node:crypto';
import {
  active,
  appOrigin,
  connection,
  failure,
  googleConfig,
  guard,
  json,
  rateLimit,
  readBody,
  seal,
  user,
} from '@/lib/server';
import { database } from '@/lib/admin';
export async function POST(req: Request) {
  try {
    guard(req);
    const auth = await user(req);
    await readBody(req);
    await rateLimit(auth, 'oauth', 10, 600000);
    const config = googleConfig(),
      conn = await connection(auth),
      state = crypto.randomUUID(),
      origin = appOrigin(req),
      expires = Date.now() + 600000;
    const verifier = Buffer.from(
      crypto.getRandomValues(new Uint8Array(32)),
    ).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const ref = database().doc(`users/${auth.owner}/oauth/${state}`);
    await database().runTransaction(async (tx) => {
      const profile = await active(tx, auth);
      tx.create(ref, {
        stateHash: createHash('sha256').update(state).digest('hex'),
        token: await seal(auth.token),
        verifier: await seal(verifier),
        expires,
        connectionRevision: conn.revision,
        generation: Number(profile?.oauthGeneration) || 0,
        browserSession: auth.browserSession || null,
        used: false,
      });
    });
    const cookie = await seal({ owner: auth.owner, state, expires });
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: origin + '/api/google/return',
      response_type: 'code',
      scope:
        'https://www.googleapis.com/auth/calendar.app.created https://www.googleapis.com/auth/calendar.events.owned.readonly',
      access_type: 'offline',
      prompt: 'consent',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString();
    return json(
      { url: url.toString() },
      {
        headers: {
          'Set-Cookie': `duenext_google=${encodeURIComponent(cookie)}; HttpOnly; Path=/api/google/return; Max-Age=600; SameSite=Lax${origin.startsWith('https:') ? '; Secure' : ''}`,
        },
      },
    );
  } catch (e) {
    return failure(e);
  }
}
