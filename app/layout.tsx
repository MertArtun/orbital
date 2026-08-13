import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import '@/app/globals.css';

export const metadata: Metadata = {
  title: 'ORBITAL — Live Space Dashboard',
  description: 'Track the ISS in real time, predict visible passes and follow upcoming launches.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  openGraph: {
    title: 'ORBITAL — Live Space Dashboard',
    description: 'A real-time 3D view of human activity in orbit.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#030014',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
