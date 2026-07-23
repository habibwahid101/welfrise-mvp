import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import PaymentCenter from './payment-center'

export const dynamic = 'force-dynamic'

export default async function PaymentsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name,role')
    .eq('id', user.id)
    .maybeSingle()

  return (
    <main className="portal-page">
      <header className="portal-head">
        <div>
          <p className="eyebrow">Welfrise · Give. Grow. Rise.</p>
          <h1>Payments & Wallet</h1>
          <p>{profile?.full_name || user.email} · closed-pilot account</p>
        </div>
        <nav className="portal-nav">
          <Link href="/app">Dashboard</Link>
          <Link href="/app/kyc">Profile & KYC</Link>
          {profile?.role === 'admin' ? <Link href="/admin">Admin</Link> : null}
        </nav>
      </header>
      <PaymentCenter />
    </main>
  )
}
