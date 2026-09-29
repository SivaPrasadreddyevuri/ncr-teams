import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'NCR Teams',
  description:
    'Collaboration workspace for communication, meetings, files and teams.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
