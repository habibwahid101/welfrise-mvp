import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function AppPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role')
    .eq('id', user.id)
    .maybeSingle()

  return (
    <main className="app-frame-page">
      <div className="app-frame-toolbar">
        <span>{profile?.full_name || user.email || 'Participant'} · Sandbox MVP</span>
        <div style={{ display: 'flex', gap: 14 }}>
          <Link href="/app/payments">Payments & Wallet</Link>
          {profile?.role === 'admin' ? <Link href="/admin">Admin</Link> : null}
          <Link href="/login">Account</Link>
        </div>
      </div>
      <iframe className="app-frame" src="/app/prototype" title="Welfrise MVP" />
    </main>
  )
}
