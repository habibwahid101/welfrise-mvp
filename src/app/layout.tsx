import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Welfrise MVP',
  description: 'Welfrise closed-pilot MVP · Give. Grow. Rise.',
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
