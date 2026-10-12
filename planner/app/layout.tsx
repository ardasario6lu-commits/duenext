import type { Metadata } from 'next';
import './globals.css';
import './apple-design.css';
import './clean-planner.css';

// Per-request CSP nonces require request-time rendering.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'DueNext · Your calendar, together',
  description:
    'Your personal calendar and to-do list for school, life, and college applications.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'DueNext', statusBarStyle: 'default' },
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
