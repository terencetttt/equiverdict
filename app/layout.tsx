import './globals.css'
import Link from 'next/link'
import WalletNav from './components/WalletNav'

export const metadata = {
  title: 'EquiVerdict',
  description: 'Evidence-led resolution for freelance disputes.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="app-shell">
          <header className="topbar">
            <div className="logo">
              <div className="seal" aria-hidden="true">
                ⚖️
              </div>
              <div>
                <h1>EquiVerdict</h1>
                <p>Evidence-led resolution for freelance disputes.</p>
              </div>
            </div>
            <div className="topbar-actions">
              <nav aria-label="Primary navigation">
                <Link href="/dashboard">Dashboard</Link>
                <Link href="/dispute/new">Create Dispute</Link>
                <Link href="/dispute/submit">Submit Evidence</Link>
                <Link href="/about">About</Link>
              </nav>
              <WalletNav />
            </div>
          </header>
          <main>{children}</main>
        </div>
      </body>
    </html>
  )
}
