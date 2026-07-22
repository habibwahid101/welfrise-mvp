import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  adjustWalletBalance,
  createReceivingWallet,
  reviewBinancePayment,
  reviewWithdrawal,
  updateKycStatus,
  updateReceivingWalletStatus,
} from './actions'

export const dynamic = 'force-dynamic'

function joined(value: unknown) {
  if (Array.isArray(value)) return value[0] as Record<string, unknown> | undefined
  return value as Record<string, unknown> | undefined
}

function money(value: unknown) {
  const amount = Number(value)
  return `$${(Number.isFinite(amount) ? amount : 0).toFixed(2)}`
}

function statusBadge(status: unknown) {
  return <span className={`badge ${String(status)}`}>{String(status)}</span>
}

export default async function AdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: me } = await supabase.from('profiles').select('role,full_name').eq('id', user.id).single()
  if (me?.role !== 'admin') redirect('/app')

  const [walletsResult, binanceResult, userWalletResult, withdrawalsResult, kycResult, accountsResult] = await Promise.all([
    supabase.from('admin_receiving_wallets').select('*').order('priority').limit(100),
    supabase.from('admin_binance_payment_requests').select('*').order('created_at', { ascending: false }).limit(100),
    supabase.from('wallet_payment_requests').select('id,amount,slots,level_id,status,created_at,participant:profiles!wallet_payment_requests_participant_id_fkey(email,full_name),payer:profiles!wallet_payment_requests_payer_id_fkey(email,full_name)').order('created_at', { ascending: false }).limit(100),
    supabase.from('withdrawals').select('id,gross_amount,fee_amount,net_amount,wallet_address,status,created_at,payout_tx_hash,profiles!withdrawals_user_id_fkey(email,full_name)').order('created_at', { ascending: false }).limit(100),
    supabase.from('kyc_submissions').select('id,user_id,status,submitted_at,id_document_path,selfie_path,address_document_path,review_note,profiles!kyc_submissions_user_id_fkey(email,full_name)').order('submitted_at', { ascending: false }).limit(100),
    supabase.from('wallet_accounts').select('user_id,available_balance,held_balance,updated_at,profiles!wallet_accounts_user_id_fkey(email,full_name,referral_code)').order('updated_at', { ascending: false }).limit(100),
  ])

  const queryError = walletsResult.error || binanceResult.error || userWalletResult.error || withdrawalsResult.error || kycResult.error || accountsResult.error
  const wallets = walletsResult.data || []
  const binance = binanceResult.data || []
  const userWalletRequests = userWalletResult.data || []
  const withdrawals = withdrawalsResult.data || []
  const kyc = kycResult.data || []
  const accounts = accountsResult.data || []

  const signedKyc = await Promise.all(kyc.map(async (item) => {
    const paths = [item.id_document_path, item.selfie_path, item.address_document_path].filter(Boolean)
    const links = await Promise.all(paths.map(async (path) => {
      const { data } = await supabase.storage.from('welfrise-private').createSignedUrl(String(path), 300)
      return data?.signedUrl || null
    }))
    return { ...item, links: links.filter(Boolean) as string[] }
  }))

  const signedBinance = await Promise.all(binance.map(async (item) => {
    if (!item.proof_path) return { ...item, proofUrl: null }
    const { data } = await supabase.storage.from('welfrise-private').createSignedUrl(String(item.proof_path), 300)
    return { ...item, proofUrl: data?.signedUrl || null }
  }))

  return (
    <main className="admin-page">
      <div className="admin-wrap">
        <header className="admin-head">
          <div><p className="eyebrow">Welfrise · Give. Grow. Rise.</p><h1>Closed-pilot administration</h1><p>{me.full_name || user.email}</p></div>
          <div className="admin-actions"><Link href="/app/payments">Payments & Wallet</Link><Link href="/app">Prototype</Link><Link href="/api/health">Health</Link></div>
        </header>

        {queryError ? <div className="notice error">Database setup incomplete: {queryError.message}. Run both Supabase migrations in order.</div> : null}

        <section className="admin-grid">
          <div className="metric"><strong>{signedBinance.filter((item) => item.status === 'submitted' || item.status === 'held').length}</strong><span>Binance reviews</span></div>
          <div className="metric"><strong>{userWalletRequests.filter((item) => item.status === 'pending').length}</strong><span>Wallet approvals pending</span></div>
          <div className="metric"><strong>{withdrawals.filter((item) => ['pending','approved','held'].includes(item.status)).length}</strong><span>Active withdrawals</span></div>
        </section>

        <section className="panel">
          <h2>Binance receiving wallets — internal only</h2>
          <p className="small-muted">Users see only the single address assigned to their active request. Labels, limits, usage, priority, and rotation remain hidden.</p>
          <form action={createReceivingWallet} className="admin-form-row">
            <input name="internalLabel" placeholder="Internal label, e.g. Wallet 1" required />
            <input name="walletAddress" placeholder="BEP20 0x wallet address" required />
            <input name="capacityLimit" type="number" min="1" step="0.01" defaultValue="10000" required />
            <input name="priority" type="number" min="1" defaultValue="100" required />
            <button type="submit">Add wallet</button>
          </form>
          <table><thead><tr><th>Internal wallet</th><th>Address</th><th>Priority</th><th>Limit</th><th>Confirmed</th><th>Reserved</th><th>Remaining</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>{wallets.map((item) => {
              const remaining = Number(item.capacity_limit) - Number(item.confirmed_amount) - Number(item.reserved_amount)
              return <tr key={item.id}><td>{item.internal_label}</td><td style={{ maxWidth: 220, wordBreak: 'break-all' }}>{item.wallet_address}</td><td>{item.priority}</td><td>{money(item.capacity_limit)}</td><td>{money(item.confirmed_amount)}</td><td>{money(item.reserved_amount)}</td><td>{money(remaining)}</td><td>{statusBadge(item.status)}</td><td><form action={updateReceivingWalletStatus} className="inline-admin-form"><input type="hidden" name="id" value={item.id} /><select name="status" defaultValue={item.status}><option value="active">Active</option><option value="paused">Paused</option><option value="capacity_reached">Capacity reached</option><option value="disabled">Disabled</option></select><button>Save</button></form></td></tr>
            })}</tbody>
          </table>
        </section>

        <section className="panel">
          <h2>Binance payment reviews</h2>
          <table><thead><tr><th>Participant</th><th>Level/package</th><th>Assigned wallet</th><th>Transaction</th><th>Proof</th><th>Status</th><th>Decision</th></tr></thead>
            <tbody>{signedBinance.map((item) => {
              return <tr key={item.id}><td>{String(item.participant_name || item.participant_email || 'User')}</td><td>Level {item.level_id}<br />{money(item.amount)} · {item.slots} slots</td><td>{String(item.receiving_wallet_label || 'Wallet')}<br /><small>{String(item.receiving_wallet_network || '')}</small></td><td style={{ maxWidth: 210, wordBreak: 'break-all' }}>{item.tx_hash || 'Not submitted'}</td><td>{item.proofUrl ? <a href={item.proofUrl} target="_blank" rel="noreferrer">View proof</a> : '—'}</td><td>{statusBadge(item.status)}</td><td>{['submitted','held'].includes(item.status) ? <form action={reviewBinancePayment} className="stack-admin-form"><input type="hidden" name="id" value={item.id} /><input name="note" placeholder="Review note" /><div><button name="decision" value="approve">Approve</button><button name="decision" value="hold">Hold</button><button className="danger-button" name="decision" value="reject">Reject</button></div></form> : '—'}</td></tr>
            })}</tbody>
          </table>
        </section>

        <section className="panel">
          <h2>User-wallet authorization activity</h2>
          <table><thead><tr><th>Participant</th><th>Wallet owner</th><th>Level/package</th><th>Status</th><th>Created</th></tr></thead>
            <tbody>{userWalletRequests.map((item) => {
              const participant = joined(item.participant)
              const payer = joined(item.payer)
              return <tr key={item.id}><td>{String(participant?.full_name || participant?.email || 'Participant')}</td><td>{String(payer?.full_name || payer?.email || 'Wallet owner')}</td><td>Level {item.level_id}<br />{money(item.amount)} · {item.slots} slots</td><td>{statusBadge(item.status)}</td><td>{new Date(item.created_at).toLocaleString()}</td></tr>
            })}</tbody>
          </table>
        </section>

        <section className="panel">
          <h2>Controlled pilot wallet balances</h2>
          <form action={adjustWalletBalance} className="admin-form-row">
            <input name="userIdentifier" placeholder="Email, referral code, or user ID" required />
            <input name="amount" type="number" step="0.01" placeholder="Positive credit / negative debit" required />
            <input name="reason" placeholder="Audit reason (minimum 5 characters)" required minLength={5} />
            <button type="submit">Apply adjustment</button>
          </form>
          <table><thead><tr><th>User</th><th>Referral code</th><th>Available</th><th>Held</th><th>Updated</th></tr></thead>
            <tbody>{accounts.map((item) => { const profile = joined(item.profiles); return <tr key={item.user_id}><td>{String(profile?.full_name || profile?.email || item.user_id)}</td><td>{String(profile?.referral_code || '—')}</td><td>{money(item.available_balance)}</td><td>{money(item.held_balance)}</td><td>{new Date(item.updated_at).toLocaleString()}</td></tr> })}</tbody>
          </table>
        </section>

        <section className="panel">
          <h2>KYC reviews</h2>
          <table><thead><tr><th>User</th><th>Documents</th><th>Status</th><th>Review</th></tr></thead>
            <tbody>{signedKyc.map((item) => { const profile = joined(item.profiles); return <tr key={item.id}><td>{String(profile?.full_name || profile?.email || 'User')}<br /><small>{new Date(item.submitted_at).toLocaleString()}</small></td><td>{item.links.map((link, index) => <span key={link}><a href={link} target="_blank" rel="noreferrer">Document {index + 1}</a>{' '}</span>)}</td><td>{statusBadge(item.status)}</td><td><form action={updateKycStatus} className="stack-admin-form"><input type="hidden" name="id" value={item.id} /><input type="hidden" name="userId" value={item.user_id} /><select name="status" defaultValue={item.status}><option value="pending">Pending</option><option value="approved">Approved</option><option value="held">Held</option><option value="rejected">Rejected</option></select><input name="reviewNote" placeholder="Review note" defaultValue={item.review_note || ''} /><button>Save</button></form></td></tr> })}</tbody>
          </table>
        </section>

        <section className="panel">
          <h2>Withdrawal reviews</h2>
          <table><thead><tr><th>User</th><th>Gross</th><th>5% fee</th><th>Net</th><th>Wallet</th><th>Status</th><th>Decision</th></tr></thead>
            <tbody>{withdrawals.map((item) => { const profile = joined(item.profiles); return <tr key={item.id}><td>{String(profile?.full_name || profile?.email || 'User')}</td><td>{money(item.gross_amount)}</td><td>{money(item.fee_amount)}</td><td>{money(item.net_amount)}</td><td style={{ maxWidth: 210, wordBreak: 'break-all' }}>{item.wallet_address}</td><td>{statusBadge(item.status)}</td><td>{['pending','approved','held'].includes(item.status) ? <form action={reviewWithdrawal} className="stack-admin-form"><input type="hidden" name="id" value={item.id} /><input name="payoutTxHash" placeholder="Payout hash (required for complete)" /><div><button name="decision" value="approve">Approve</button><button name="decision" value="hold">Hold</button><button name="decision" value="complete">Complete</button><button className="danger-button" name="decision" value="reject">Reject</button></div></form> : item.payout_tx_hash || '—'}</td></tr> })}</tbody>
          </table>
        </section>
      </div>
    </main>
  )
}
