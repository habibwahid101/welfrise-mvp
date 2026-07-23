import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { CopyReferral } from './dashboard-client'

export const dynamic = 'force-dynamic'

const statusLabels: Record<string, string> = { not_submitted: 'Not submitted', pending: 'Pending', approved: 'Approved', rejected: 'Rejected', held: 'Under review', capacity_reached: 'Capacity reached' }
function status(value: unknown) { const key = String(value || ''); return statusLabels[key] || key.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase()) }
function money(value: unknown) { const amount = Number(value); return `$${(Number.isFinite(amount) ? amount : 0).toFixed(2)}` }
function date(value: unknown) { const parsed = new Date(String(value)); return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString() }

export default async function AppPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  await supabase.rpc('welfrise_expire_stale_payment_requests')
  const [profileResult, walletResult, slotsResult, ledgerResult, incomingResult, outgoingResult, noticesResult, referrerResult] = await Promise.all([
    supabase.from('profiles').select('full_name,email,role,referral_code,referral_code_used,kyc_status,highest_unlocked_level,championship_cycle,championship_status').eq('id', user.id).single(),
    supabase.from('wallet_accounts').select('available_balance,held_balance').eq('user_id', user.id).maybeSingle(),
    supabase.from('participation_slots').select('id,status,level_id,level_position,payout_amount,created_at').eq('participant_id', user.id).order('created_at', { ascending: false }).limit(50),
    supabase.from('wallet_ledger').select('id,direction,amount,description,created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(8),
    supabase.from('wallet_payment_requests').select('id,participant_display,amount,slots,level_id,status,expires_at').eq('payer_id', user.id).eq('status', 'pending').order('created_at', { ascending: false }).limit(8),
    supabase.from('wallet_payment_requests').select('id,payer_display,amount,slots,level_id,status,created_at').eq('participant_id', user.id).eq('status', 'pending').order('created_at', { ascending: false }).limit(8),
    supabase.from('notifications').select('id,title,message,created_at,is_read').eq('user_id', user.id).order('created_at', { ascending: false }).limit(8),
    supabase.rpc('welfrise_registered_referrer_display'),
  ])
  const queryError = profileResult.error || walletResult.error || slotsResult.error || ledgerResult.error || incomingResult.error || outgoingResult.error || noticesResult.error || referrerResult.error
  const profile = profileResult.data
  const wallet = walletResult.data
  const slots = slotsResult.data || []
  const activeSlots = slots.filter((slot) => slot.status === 'waiting').length
  const completedSlots = slots.filter((slot) => slot.status === 'completed').length

  return (
    <main className="portal-page">
      <header className="portal-head dashboard-head"><div><p className="eyebrow">Welfrise · Give. Grow. Rise.</p><h1>Member dashboard</h1><p>{profile?.full_name || user.email} · {user.email}</p></div><nav className="portal-nav"><Link href="/app/payments">Payments & Wallet</Link><Link href="/app/kyc">Profile & KYC</Link><Link href="/account/security">Account Security</Link>{profile?.role === 'admin' ? <Link href="/admin">Admin</Link> : null}<form action="/api/logout" method="post"><button className="nav-button">Sign out</button></form></nav></header>
      <div className="portal-stack">
        {queryError ? <div className="notice error" role="alert">Dashboard data is temporarily unavailable. Please try again.</div> : null}
        <section className="dashboard-identity">
          <div><span>Referral code</span><div className="referral-value"><strong>{profile?.referral_code || '—'}</strong>{profile?.referral_code ? <CopyReferral code={profile.referral_code} /> : null}</div></div>
          <div><span>Registered referrer</span><strong>{referrerResult.data || 'Global Charity Fund allocation'}</strong></div>
        </section>
        <section className="portal-metrics dashboard-metrics">
          <div><span>Available balance</span><strong>{money(wallet?.available_balance)}</strong></div><div><span>Held balance</span><strong>{money(wallet?.held_balance)}</strong></div><div><span>Unlocked level</span><strong>Level {profile?.highest_unlocked_level || 1}</strong></div><div><span>KYC status</span><strong>{status(profile?.kyc_status || 'not_submitted')}</strong></div><div><span>Championship</span><strong>Cycle {profile?.championship_cycle || 1} · {status(profile?.championship_status || 'active')}</strong></div><div><span>Active waiting slots</span><strong>{activeSlots}</strong></div><div><span>Completed slots</span><strong>{completedSlots}</strong></div><div><span>Pending authorizations</span><strong>{(incomingResult.data || []).length + (outgoingResult.data || []).length}</strong></div>
        </section>
        <section className="portal-grid-two">
          <div className="portal-panel"><h2>Pending incoming wallet authorizations</h2><div className="compact-list">{(incomingResult.data || []).map((item) => <div key={item.id}><span>{item.participant_display}<small>Level: {item.level_id} · Slots: {item.slots} · expires {date(item.expires_at)}</small></span><strong>Amount: {money(item.amount)}</strong></div>)}{!incomingResult.data?.length ? <p className="empty-copy">No requests need your approval.</p> : null}</div><Link className="text-link" href="/app/payments">Review authorizations</Link></div>
          <div className="portal-panel"><h2>Pending outgoing requests</h2><div className="compact-list">{(outgoingResult.data || []).map((item) => <div key={item.id}><span>{item.payer_display}<small>Level: {item.level_id} · Slots: {item.slots} · {date(item.created_at)}</small></span><strong>Amount: {money(item.amount)}</strong></div>)}{!outgoingResult.data?.length ? <p className="empty-copy">No pending outgoing requests.</p> : null}</div><Link className="text-link" href="/app/payments">Manage requests</Link></div>
        </section>
        <section className="portal-grid-two">
          <div className="portal-panel"><h2>Recent wallet transactions</h2><div className="compact-list">{(ledgerResult.data || []).map((item) => <div key={item.id}><span>{item.description}<small>{date(item.created_at)}</small></span><strong className={item.direction === 'credit' ? 'positive' : 'negative'}>{item.direction === 'credit' ? '+' : '-'}{money(item.amount)}</strong></div>)}{!ledgerResult.data?.length ? <p className="empty-copy">No wallet transactions yet.</p> : null}</div></div>
          <div className="portal-panel"><h2>Recent notifications</h2><div className="compact-list">{(noticesResult.data || []).map((item) => <div key={item.id}><span><strong>{item.title}</strong><small>{item.message} · {date(item.created_at)}</small></span></div>)}{!noticesResult.data?.length ? <p className="empty-copy">No notifications.</p> : null}</div></div>
        </section>
      </div>
    </main>
  )
}
