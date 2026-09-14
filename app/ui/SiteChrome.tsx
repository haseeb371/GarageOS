'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export function SiteChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || ''
  const bare =
    pathname.startsWith('/estimate/') ||
    pathname.startsWith('/portal/') ||
    pathname.startsWith('/book/') ||
    pathname === '/tech' ||
    pathname.startsWith('/tech/')
  if (bare) return <>{children}</>

  return (
    <>
      <header className="site-chrome-bar">
        <Link href="/" className="site-brand">
          AutoGaragify
        </Link>
        <nav className="site-chrome-nav">
          <Link href="/tech">Tech bay</Link>
          <Link href="/demo-call">Call for a live demo</Link>
          <Link href="/leads">Leads</Link>
          <Link href="/campaigns">Campaigns</Link>
        </nav>
      </header>
      {children}
      <footer className="site-chrome-footer">
        <Link href="/tech">Tech bay</Link>
        <span className="muted"> · </span>
        <Link href="/demo-call">Call for a live demo</Link>
        <span className="muted"> · AutoGaragify AI voice</span>
      </footer>
    </>
  )
}
