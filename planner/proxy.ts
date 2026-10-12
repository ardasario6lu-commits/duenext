import { NextResponse, type NextRequest } from 'next/server';
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(
      crypto.getRandomValues(new Uint8Array(18)),
    ).toString('base64'),
    dev = process.env.NODE_ENV !== 'production';
  const csp = `default-src 'self'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://lh3.googleusercontent.com; font-src 'self'; connect-src 'self' https://*.googleapis.com https://*.firebaseapp.com https://*.web.app https://accounts.google.com${dev ? ' http://localhost:9099 http://127.0.0.1:9099 ws://localhost:* ws://127.0.0.1:*' : ''}; frame-src https://*.firebaseapp.com https://*.web.app https://accounts.google.com${dev ? ' http://localhost:9099 http://127.0.0.1:9099' : ''}; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self';${dev ? '' : ' upgrade-insecure-requests;'}`;
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}
export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest).*)',
  ],
};
