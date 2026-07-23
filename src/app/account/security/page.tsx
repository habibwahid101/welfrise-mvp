import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import SecurityCenter from './security-center'

export const dynamic = 'force-dynamic'

export default async function AccountSecurityPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase.from('profiles').select('full_name,role').eq('id', user.id).single()
  return <main className="portal-page"><header className="portal-head"><div><p className="eyebrow">Welfrise · Give. Grow. Rise.</p><h1>Account security</h1><p>{profile?.full_name || user.email}</p></div><nav className="portal-nav"><Link href="/app">Dashboard</Link><Link href="/app/kyc">Profile & KYC</Link></nav></header><SecurityCenter isAdmin={profile?.role === 'admin'} /></main>
}
