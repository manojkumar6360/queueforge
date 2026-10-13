import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'QueueForge | Virtual Waiting Room & Seat Reservation Engine',
  description: 'Distributed Virtual Waiting Room & High-Concurrency Flash Reservation Engine',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased selection:bg-indigo-500 selection:text-white">
        {children}
      </body>
    </html>
  );
}
