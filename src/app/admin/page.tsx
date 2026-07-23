import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  BinanceReviewForm, KycReviewForm, MaskedValue, ReceivingWalletForm,
  WalletAdjustmentForm, WalletStatusForm, WithdrawalReviewForm,
} from './admin-forms'

export const dynamic = 'force-dynamic'

function joined(value: unknown) { return (Array.isArray(value) ? value[0] : value) as Record<string, unknown> | undefined }
function money(value: unknown) { const amount = Number(value); return `$${(Number.isFinite(amount) ? amount : 0).toFixed(2)}` }
function label(value: unknown) { const key = String(value || ''); const labels: Record<string, string> = { not_submitted: 'Not submitted', held: 'Under review', capacity_reached: 'Capacity reached' }; return labels[key] || key.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase()) }
function statusBadge(value: unknown) { return <span className={`badge ${String(value)}`}>{label(value)}</span> }

export default async function AdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: me } = await supabase.from('profiles').select('role,full_name').eq('id', user.id).single()
  if (me?.role !== 'admin') redirect('/app')
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  const mutationEnabled = aal?.currentLevel === 'aal2'

  const [walletsResult, binanceResult, userWalletResult, withdrawalsResult, kycResult, accountsResult, treasuryResult] = await Promise.all([
    supabase.from('admin_receiving_wallets').select('*').order('priority').order('created_at').limit(100),
    supabase.from('admin_binance_payment_requests').select('*').order('created_at', { ascending: false }).limit(100),
    supabase.from('wallet_payment_requests').select('id,amount,slots,level_id,status,created_at,participant:profiles!wallet_payment_requests_participant_id_fkey(email,full_name),payer:profiles!wallet_payment_requests_payer_id_fkey(email,full_name)').order('created_at', { ascending: false }).limit(100),
    supabase.from('withdrawals').select('id,gross_amount,fee_amount,net_amount,wallet_address,status,created_at,payout_tx_hash,profiles!withdrawals_user_id_fkey(email,full_name)').order('created_at', { ascending: false }).limit(100),
    supabase.from('kyc_submissions').select('id,user_id,status,submitted_at,id_document_path,selfie_path,address_document_path,review_note,profiles!kyc_submissions_user_id_fkey(email,full_name)').order('submitted_at', { ascending: false }).limit(100),
    supabase.from('wallet_accounts').select('user_id,available_balance,held_balance,updated_at,profiles!wallet_accounts_user_id_fkey(email,full_name,referral_code)').order('updated_at', { ascending: false }).limit(100),
    supabase.from('admin_treasury_exposure').select('*').maybeSingle(),
  ])
  const queryError = walletsResult.error || binanceResult.error || userWalletResult.error || withdrawalsResult.error || kycResult.error || accountsResult.error || treasuryResult.error
  const wallets = walletsResult.data || []
  const binance = binanceResult.data || []
  const userWalletRequests = userWalletResult.data || []
  const withdrawals = withdrawalsResult.data || []
  const kyc = kycResult.data || []
  const accounts = accountsResult.data || []
  const treasury = treasuryResult.data as Record<string, unknown> | null

  const signedKyc = await Promise.all(kyc.map(async (item) => {
    if (!mutationEnabled) return { ...item, links: [] as string[] }
    const paths = [item.id_document_path, item.selfie_path, item.address_document_path].filter(Boolean)
    const links = await Promise.all(paths.map(async (path) => (await supabase.storage.from('welfrise-private').createSignedUrl(String(path), 300)).data?.signedUrl || null))
    return { ...item, links: links.filter(Boolean) as string[] }
  }))
  const signedBinance = await Promise.all(binance.map(async (item) => {
    if (!mutationEnabled || !item.proof_path) return { ...item, proofUrl: null }
    return { ...item, proofUrl: (await supabase.storage.from('welfrise-private').createSignedUrl(String(item.proof_path), 300)).data?.signedUrl || null }
  }))

  return <main className="admin-page"><div className="admin-wrap">
    <header className="admin-head"><div><p className="eyebrow">Welfrise · Give. Grow. Rise.</p><h1>Closed-pilot administration</h1><p>{me.full_name || user.email}</p></div><nav className="admin-actions"><Link href="/app">Dashboard</Link><Link href="/app/payments">Payments & Wallet</Link><Link href="/account/security">Account Security</Link><Link href="/api/health">System Health</Link></nav></header>
    {!mutationEnabled ? <div className="notice error" role="alert"><strong>Read-only admin view.</strong> Complete MFA verification to continue with financial or KYC changes. <Link href="/account/security">Verify MFA</Link></div> : null}
    {queryError ? <div className="notice error" role="alert">Some admin data is temporarily unavailable. Confirm migrations 001 through 005 are applied.</div> : null}
    <section className="admin-grid"><div className="metric"><strong>{signedBinance.filter((item) => ['submitted','held'].includes(item.status)).length}</strong><span>Binance reviews</span></div><div className="metric"><strong>{userWalletRequests.filter((item) => item.status === 'pending').length}</strong><span>Pending wallet authorizations</span></div><div className="metric"><strong>{withdrawals.filter((item) => ['pending','approved','held'].includes(item.status)).length}</strong><span>Active withdrawals</span></div></section>

    <section className="panel"><h2>Treasury exposure</h2><p className="treasury-warning">Closed-pilot financial exposure only. This does not confirm funding sufficiency or authorize public launch.</p><div className="treasury-grid"><div><span>Confirmed participation receipts</span><strong>{money(treasury?.total_confirmed_participation_receipts)}</strong></div><div><span>Charity allocations</span><strong>{money(treasury?.charity_allocations)}</strong></div><div><span>Referral commissions</span><strong>{money(treasury?.referral_commissions)}</strong></div><div><span>Level Bonus Reserve</span><strong>{money(treasury?.level_bonus_reserve_allocations)}</strong></div><div><span>Operations allocations</span><strong>{money(treasury?.operations_allocations)}</strong></div><div><span>Available-wallet liabilities</span><strong>{money(treasury?.available_wallet_liabilities)}</strong></div><div><span>Held-wallet liabilities</span><strong>{money(treasury?.held_wallet_liabilities)}</strong></div><div><span>Completed payout liabilities</span><strong>{money(treasury?.completed_payout_liabilities)}</strong></div><div><span>Reserve coverage ratio</span><strong>{Number(treasury?.reserve_coverage_ratio || 0).toFixed(4)}</strong></div></div>{treasury?.reserve_below_payout_liability ? <div className="notice error" role="alert">Recorded Level Bonus Reserve is below completed payout liability.</div> : null}<p className="small-muted">Waiting-slot exposure by level: <code>{JSON.stringify(treasury?.waiting_slot_exposure_by_level || {})}</code></p></section>

    <section className="panel"><h2>Binance receiving wallets — internal only</h2><p className="small-muted">Full wallet-management data remains admin-only.</p><ReceivingWalletForm enabled={mutationEnabled} /><div className="table-scroll"><table><thead><tr><th>Internal wallet</th><th>Address</th><th>Priority</th><th>Limit</th><th>Confirmed</th><th>Reserved</th><th>Remaining</th><th>Status</th><th>Action</th></tr></thead><tbody>{wallets.map((item) => { const remaining = Number(item.capacity_limit) - Number(item.confirmed_amount) - Number(item.reserved_amount); return <tr key={item.id}><td>{item.internal_label}</td><td><MaskedValue value={String(item.wallet_address)} /></td><td>{item.priority}</td><td>{money(item.capacity_limit)}</td><td>{money(item.confirmed_amount)}</td><td>{money(item.reserved_amount)}</td><td>{money(remaining)}</td><td>{statusBadge(item.status)}</td><td><WalletStatusForm id={item.id} current={item.status} enabled={mutationEnabled} /></td></tr> })}</tbody></table></div></section>

    <section className="panel"><h2>Binance payment reviews</h2><p className="small-muted">A screenshot is supporting evidence only. Approval requires a successful independent on-chain match against the configured chain, contract, recipient, amount, and confirmation policy.</p><div className="table-scroll"><table><thead><tr><th>Participant</th><th>Level</th><th>Slots</th><th>Amount</th><th>Request address</th><th>Transaction & proof</th><th>Status</th><th>Verification</th></tr></thead><tbody>{signedBinance.map((item) => <tr key={item.id}><td>{String(item.participant_name || item.participant_email || 'User')}</td><td>Level {item.level_id}</td><td>{item.slots}</td><td>{money(item.amount)}</td><td><MaskedValue value={String(item.assigned_wallet_address || '')} /></td><td>{item.tx_hash ? <MaskedValue value={String(item.tx_hash)} /> : 'Not submitted'}<br />{item.proofUrl ? <a href={item.proofUrl} target="_blank" rel="noreferrer">View private proof</a> : mutationEnabled ? '—' : 'Verify MFA to view proof'}</td><td>{statusBadge(item.status)}</td><td>{['submitted','held'].includes(item.status) ? <BinanceReviewForm id={item.id} amount={String(item.amount)} address={String(item.assigned_wallet_address || '')} enabled={mutationEnabled} /> : '—'}</td></tr>)}</tbody></table></div></section>

    <section className="panel"><h2>User Wallet authorization activity</h2><div className="table-scroll"><table><thead><tr><th>Participant</th><th>Wallet owner</th><th>Level</th><th>Slots</th><th>Amount</th><th>Status</th><th>Created</th></tr></thead><tbody>{userWalletRequests.map((item) => { const participant = joined(item.participant); const payer = joined(item.payer); return <tr key={item.id}><td>{String(participant?.full_name || participant?.email || 'Participant')}</td><td>{String(payer?.full_name || payer?.email || 'Wallet owner')}</td><td>Level {item.level_id}</td><td>{item.slots}</td><td>{money(item.amount)}</td><td>{statusBadge(item.status)}</td><td>{new Date(item.created_at).toLocaleString()}</td></tr> })}</tbody></table></div></section>

    <section className="panel"><h2>Controlled pilot wallet balances</h2><WalletAdjustmentForm enabled={mutationEnabled} /><div className="table-scroll"><table><thead><tr><th>User</th><th>Referral code</th><th>Available</th><th>Held</th><th>Updated</th></tr></thead><tbody>{accounts.map((item) => { const profile = joined(item.profiles); return <tr key={item.user_id}><td>{String(profile?.full_name || profile?.email || item.user_id)}</td><td>{String(profile?.referral_code || '—')}</td><td>{money(item.available_balance)}</td><td>{money(item.held_balance)}</td><td>{new Date(item.updated_at).toLocaleString()}</td></tr> })}</tbody></table></div></section>

    <section className="panel"><h2>KYC reviews</h2><div className="table-scroll"><table><thead><tr><th>User</th><th>Documents</th><th>Status</th><th>Review</th></tr></thead><tbody>{signedKyc.map((item) => { const profile = joined(item.profiles); return <tr key={item.id}><td>{String(profile?.full_name || profile?.email || 'User')}<br /><small>{new Date(item.submitted_at).toLocaleString()}</small></td><td>{item.links.length ? item.links.map((link, index) => <span key={link}><a href={link} target="_blank" rel="noreferrer">Document {index + 1}</a>{' '}</span>) : mutationEnabled ? '—' : 'Verify MFA to view'}</td><td>{statusBadge(item.status)}</td><td><KycReviewForm id={item.id} current={item.status} note={item.review_note || ''} enabled={mutationEnabled} /></td></tr> })}</tbody></table></div></section>

    <section className="panel"><h2>Withdrawal reviews</h2><div className="table-scroll"><table><thead><tr><th>User</th><th>Gross</th><th>5% fee</th><th>Net</th><th>Wallet</th><th>Status</th><th>Decision</th></tr></thead><tbody>{withdrawals.map((item) => { const profile = joined(item.profiles); return <tr key={item.id}><td>{String(profile?.full_name || profile?.email || 'User')}</td><td>{money(item.gross_amount)}</td><td>{money(item.fee_amount)}</td><td>{money(item.net_amount)}</td><td><MaskedValue value={String(item.wallet_address)} /></td><td>{statusBadge(item.status)}</td><td>{['pending','approved','held'].includes(item.status) ? <WithdrawalReviewForm id={item.id} enabled={mutationEnabled} /> : item.payout_tx_hash ? <MaskedValue value={item.payout_tx_hash} /> : '—'}</td></tr> })}</tbody></table></div></section>
  </div></main>
}
