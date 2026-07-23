import Link from 'next/link'

export default function HomePage() {
  return <main className="public-home"><section className="public-hero"><p className="eyebrow">Welfrise</p><h1>Give. Grow. Rise.</h1><p>Welfrise is operating as an invitation-only closed pilot. Existing members can access the secure participant dashboard.</p><div className="hero-actions"><Link className="primary-link" href="/login">Member sign in</Link><Link className="secondary-button" href="/register">Use pilot invitation</Link></div><div className="pilot-warning">Closed-pilot participation only. Public real-money launch is not authorized.</div></section></main>
}
