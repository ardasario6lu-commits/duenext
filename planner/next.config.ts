import type { NextConfig } from 'next';
const config: NextConfig = {
  distDir: process.env.DUENEXT_BUILD_DIR || '.next',
  // Lambda disables CommonJS require(ESM); bundle Firebase's JOSE chain so
  // authentication can load there without weakening token verification.
  transpilePackages: ['firebase-admin', 'jwks-rsa', 'jose'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), serial=(self)',
          },
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin-allow-popups',
          },
          ...(process.env.NODE_ENV === 'production'
            ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000' }]
            : []),
        ],
      },
    ];
  },
};
export default config;
