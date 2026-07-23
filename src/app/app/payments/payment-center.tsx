'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

type Dashboard = {
  profile: { full_name?: string; email?: string; referral_code?: string; kyc_status?: string; highest_unlocked_level?: number }
  wallet: { available_balance: number | string; held_balance: number | string }
  ledger: Array<Record<string, unknown>>
  binancePayments: Array<Record<string, unknown>>
  incomingWalletRequests: Array<Record<string, unknown>>
  outgoingWalletRequests: Array<Record<string, unknown>>
  slots: Array<Record<string, unknown>>
  notifications: Array<Record<string, unknown>>
  withdrawals: Array<Record<string, unknown>>
}

type AssignedPayment = {
  request_id: string
  wallet_address: string
  token: string
  network: string
  amount: number | string
  expires_at: string
}

const packages = [
  { amount: 10, slots: 1 },
  { amount: 20, slots: 2 },
  { amount: 50, slots: 5 },
  { amount: 100, slots: 10 },
]

const BEP20_WALLET_PATTERN = /^0x[a-fA-F0-9]{40}$/

function asNumber(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function money(value: unknown) {
  return `$${asNumber(value).toFixed(2)}`
}

function formatDate(value: unknown) {
  if (!value) return '—'
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

function formatKycStatus(value: unknown) {
  const status = String(value || 'not_submitted').toLowerCase()
  const labels: Record<string, string> = {
    not_submitted: 'Not submitted',
    pending: 'Pending',
    approved: 'Approved',
    rejected: 'Rejected',
    held: 'Under review',
  }
  return labels[status] || status.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase())
}

async function jsonRequest(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || 'Request failed')
  return body
}

function mutationHeaders(contentType?: string) {
  return { ...(contentType ? { 'content-type': contentType } : {}), 'idempotency-key': crypto.randomUUID() }
}

export default function PaymentCenter() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [method, setMethod] = useState<'binance' | 'user-wallet'>('binance')
  const [level, setLevel] = useState(1)
  const [packageAmount, setPackageAmount] = useState(10)
  const [payerIdentifier, setPayerIdentifier] = useState('')
  const [assigned, setAssigned] = useState<AssignedPayment | null>(null)
  const [txHash, setTxHash] = useState('')
  const [proof, setProof] = useState<File | null>(null)
  const [withdrawalAmount, setWithdrawalAmount] = useState(10)
  const [withdrawalAddress, setWithdrawalAddress] = useState('')

  const selectedPackage = useMemo(
    () => packages.find((item) => item.amount === packageAmount) || packages[0],
    [packageAmount],
  )

  const load = useCallback(async () => {
    try {
      const data = await jsonRequest('/api/payments/dashboard', { cache: 'no-store' })
      setDashboard(data)
      setLevel((current) => Math.min(current, Number(data.profile?.highest_unlocked_level || 1)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load the payment center')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  function resetNotice() {
    setMessage('')
    setError('')
  }

  async function createPayment() {
    resetNotice()
    setBusy('create')
    try {
      if (method === 'binance') {
        const result = await jsonRequest('/api/payments/binance/request', {
          method: 'POST', headers: mutationHeaders('application/json'),
          body: JSON.stringify({ amount: selectedPackage.amount, slots: selectedPackage.slots, level }),
        })
        setAssigned(result.payment)
        setMessage('A receiving address has been assigned to this request. Send the exact amount before expiry.')
      } else {
        const result = await jsonRequest('/api/payments/user-wallet', {
          method: 'POST', headers: mutationHeaders('application/json'),
          body: JSON.stringify({ payerIdentifier, amount: selectedPackage.amount, slots: selectedPackage.slots, level }),
        })
        setMessage(`Authorization request sent to ${result.request?.payer_display || 'the wallet owner'}.`)
        setPayerIdentifier('')
        await load()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create payment request')
    } finally {
      setBusy('')
    }
  }

  async function submitBinanceProof(event: React.FormEvent) {
    event.preventDefault()
    if (!assigned || !proof) return
    resetNotice()
    setBusy('proof')
    try {
      const form = new FormData()
      form.set('requestId', assigned.request_id)
      form.set('txHash', txHash)
      form.set('proof', proof)
      await jsonRequest('/api/payments/binance/submit', { method: 'POST', headers: mutationHeaders(), body: form })
      setMessage('Payment proof submitted for admin verification.')
      setAssigned(null)
      setTxHash('')
      setProof(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit payment proof')
    } finally {
      setBusy('')
    }
  }

  async function walletRequestAction(requestId: string, action: 'approve' | 'decline' | 'cancel') {
    resetNotice()
    setBusy(requestId + action)
    try {
      const result = await jsonRequest('/api/payments/user-wallet', {
        method: 'PATCH', headers: mutationHeaders('application/json'),
        body: JSON.stringify({ requestId, action }),
      })
      setMessage(`Request ${String(result.status).replaceAll('_', ' ')}.`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update request')
    } finally {
      setBusy('')
    }
  }

  async function requestWithdrawal(event: React.FormEvent) {
    event.preventDefault()
    if (withdrawalDisabledReason) return
    resetNotice()
    setBusy('withdrawal')
    try {
      const result = await jsonRequest('/api/withdrawals', {
        method: 'POST', headers: mutationHeaders('application/json'),
        body: JSON.stringify({ grossAmount: withdrawalAmount, walletAddress: withdrawalAddress }),
      })
      setMessage(`Withdrawal submitted: ${money(result.withdrawal?.gross_amount)} gross, ${money(result.withdrawal?.fee_amount)} fee, ${money(result.withdrawal?.net_amount)} net.`)
      setWithdrawalAddress('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit withdrawal')
    } finally {
      setBusy('')
    }
  }

  if (loading && !dashboard) return <section className="portal-panel"><p>Loading payment center…</p></section>

  const available = asNumber(dashboard?.wallet?.available_balance)
  const held = asNumber(dashboard?.wallet?.held_balance)
  const unlocked = Number(dashboard?.profile?.highest_unlocked_level || 1)
  const kycStatus = String(dashboard?.profile?.kyc_status || 'not_submitted').toLowerCase()
  const fee = Math.round(withdrawalAmount * 5) / 100
  const net = Math.round((withdrawalAmount - fee) * 100) / 100
  const withdrawalAmountValid = Number.isFinite(withdrawalAmount) && withdrawalAmount >= 10 && withdrawalAmount <= 100
  const withdrawalAddressValid = BEP20_WALLET_PATTERN.test(withdrawalAddress.trim())
  const withdrawalDisabledReason = busy === 'withdrawal'
    ? 'Your withdrawal request is being submitted.'
    : kycStatus !== 'approved'
      ? 'Complete and receive approval for KYC before withdrawing.'
      : !withdrawalAmountValid
        ? 'Enter a gross amount between $10 and $100.'
        : available < withdrawalAmount
          ? 'Your available balance is insufficient.'
          : !withdrawalAddressValid
            ? 'Enter a valid BEP20 wallet address.'
            : ''

  return (
    <div className="portal-stack">
      {message ? <div className="notice success" role="status" aria-live="polite">{message}</div> : null}
      {error ? <div className="notice error" role="alert" aria-live="assertive">{error}</div> : null}

      <section className="portal-metrics">
        <div><span>Available wallet</span><strong>{money(available)}</strong></div>
        <div><span>Held balance</span><strong>{money(held)}</strong></div>
        <div><span>Unlocked level</span><strong>Level {unlocked}</strong></div>
        <div><span>KYC status</span><strong>{formatKycStatus(kycStatus)}</strong></div>
      </section>

      <section className="portal-panel">
        <div className="panel-title-row">
          <div><h2>Purchase participation slots</h2><p>Commission always follows the participant’s registered referrer.</p></div>
          <button className="ghost-button" type="button" onClick={() => void load()}>Refresh</button>
        </div>

        <div className="method-switch">
          <button type="button" className={method === 'binance' ? 'active' : ''} onClick={() => { setMethod('binance'); setAssigned(null) }}>Pay by Binance Wallet</button>
          <button type="button" className={method === 'user-wallet' ? 'active' : ''} onClick={() => { setMethod('user-wallet'); setAssigned(null) }}>Pay by User Wallet</button>
        </div>

        <div className="form-grid">
          <label>Level<select value={level} onChange={(e) => setLevel(Number(e.target.value))}>{Array.from({ length: unlocked }, (_, index) => <option key={index + 1} value={index + 1}>Level {index + 1}</option>)}</select></label>
          <label>Package<select value={packageAmount} onChange={(e) => setPackageAmount(Number(e.target.value))}>{packages.map((item) => <option key={item.amount} value={item.amount}>{money(item.amount)} · {item.slots} slot{item.slots > 1 ? 's' : ''}</option>)}</select></label>
          {method === 'user-wallet' ? <label>Wallet owner ID, referral code, or email<input value={payerIdentifier} onChange={(e) => setPayerIdentifier(e.target.value)} placeholder="Enter wallet owner identifier" /></label> : null}
        </div>

        <div className="rule-box">
          {method === 'binance'
            ? 'A secure payment address will be assigned for this payment request.'
            : 'The wallet owner receives Approve or Decline. No deduction, slot, or commission occurs before approval.'}
        </div>
        <button className="primary-button portal-action" type="button" disabled={busy === 'create' || (method === 'user-wallet' && !payerIdentifier.trim())} onClick={() => void createPayment()}>{busy === 'create' ? 'Creating…' : method === 'binance' ? 'Generate payment address' : 'Send authorization request'}</button>
      </section>

      {assigned ? <section className="portal-panel assigned-card">
        <h2>Active Binance payment request</h2>
        <p>Send exactly <strong>{money(assigned.amount)} {assigned.token}</strong> through <strong>{assigned.network}</strong>.</p>
        <div className="copy-row"><code>{assigned.wallet_address}</code><button type="button" onClick={() => void navigator.clipboard.writeText(assigned.wallet_address)}>Copy</button></div>
        <p className="small-muted">Expires: {formatDate(assigned.expires_at)}. The assigned address will not change during this request.</p>
        <form className="form-grid single-column" onSubmit={submitBinanceProof}>
          <label>Transaction hash<input value={txHash} onChange={(e) => setTxHash(e.target.value)} minLength={10} required /></label>
          <label>Payment proof<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setProof(e.target.files?.[0] || null)} required /></label>
          <button className="primary-button" disabled={busy === 'proof'}>{busy === 'proof' ? 'Submitting…' : 'Submit payment proof'}</button>
        </form>
      </section> : null}

      <section className="portal-grid-two">
        <div className="portal-panel">
          <h2>Requests needing your approval</h2>
          <div className="request-list">{(dashboard?.incomingWalletRequests || []).length ? dashboard!.incomingWalletRequests.map((item) => {
            const pending = item.status === 'pending'
            return <article key={String(item.id)} className="request-card"><div><strong>{String(item.participant_display || 'Participant')}</strong><span>{money(item.amount)} · Level {String(item.level_id)} · {String(item.slots)} slot(s)</span><small>Balance before: {money(available)} · after approval: {money(Math.max(0, available - asNumber(item.amount)))}</small><small>The participant receives the slot(s); commission follows the participant’s registered referrer.</small><small>{formatKycStatus(item.status)} · expires {formatDate(item.expires_at)}</small></div>{pending ? <div className="inline-actions"><button disabled={Boolean(busy)} onClick={() => { if (window.confirm(`Approve ${money(item.amount)} for ${String(item.participant_display || 'this participant')}? Your wallet will be debited.`)) void walletRequestAction(String(item.id), 'approve') }}>Approve</button><button className="danger-button" disabled={Boolean(busy)} onClick={() => void walletRequestAction(String(item.id), 'decline')}>Decline</button></div> : null}</article>
          }) : <p className="empty-copy">No wallet authorization requests.</p>}</div>
        </div>

        <div className="portal-panel">
          <h2>Your outgoing wallet requests</h2>
          <div className="request-list">{(dashboard?.outgoingWalletRequests || []).length ? dashboard!.outgoingWalletRequests.map((item) => {
            return <article key={String(item.id)} className="request-card"><div><strong>{String(item.payer_display || 'Wallet owner')}</strong><span>{money(item.amount)} · Level {String(item.level_id)} · {String(item.slots)} slot(s)</span><small>{formatKycStatus(item.status)} · {formatDate(item.created_at)}</small></div>{item.status === 'pending' ? <button className="danger-button" disabled={Boolean(busy)} onClick={() => void walletRequestAction(String(item.id), 'cancel')}>Cancel</button> : null}</article>
          }) : <p className="empty-copy">No outgoing requests.</p>}</div>
        </div>
      </section>

      <section className="portal-panel">
        <h2>Withdraw funds</h2>
        <p>Approved KYC is required. The fee is 5% of the gross request and the daily gross limit is $100.</p>
        <form className="form-grid" onSubmit={requestWithdrawal}>
          <label>Gross amount<input type="number" min={10} max={100} step="0.01" value={withdrawalAmount} onChange={(e) => setWithdrawalAmount(Number(e.target.value))} /></label>
          <label>BEP20 wallet address<input value={withdrawalAddress} onChange={(e) => setWithdrawalAddress(e.target.value)} placeholder="0x…" required /></label>
          <div className="withdrawal-preview"><span>Gross {money(withdrawalAmount)}</span><span>Fee {money(fee)}</span><strong>Net {money(net)}</strong></div>
          <div className="withdrawal-submit">
            <button className="primary-button" disabled={Boolean(withdrawalDisabledReason)}>{busy === 'withdrawal' ? 'Submitting…' : 'Request withdrawal'}</button>
            {withdrawalDisabledReason ? <p className="small-muted" role="status">{withdrawalDisabledReason}</p> : null}
          </div>
        </form>
      </section>

      <section className="portal-grid-two">
        <div className="portal-panel"><h2>Recent participation slots</h2><div className="compact-list">{(dashboard?.slots || []).slice(0, 12).map((item) => <div key={String(item.id)}><span>Level {String(item.level_id)} · Position {String(item.level_position)}</span><strong>{String(item.status)}{asNumber(item.payout_amount) ? ` · ${money(item.payout_amount)}` : ''}</strong></div>)}{!dashboard?.slots?.length ? <p className="empty-copy">No server-approved slots yet.</p> : null}</div></div>
        <div className="portal-panel"><h2>Wallet history</h2><div className="compact-list">{(dashboard?.ledger || []).slice(0, 12).map((item) => <div key={String(item.id)}><span>{String(item.description)}<small>{formatDate(item.created_at)}</small></span><strong className={item.direction === 'credit' ? 'positive' : 'negative'}>{item.direction === 'credit' ? '+' : '-'}{money(item.amount)}</strong></div>)}{!dashboard?.ledger?.length ? <p className="empty-copy">No wallet entries yet.</p> : null}</div></div>
      </section>

      <section className="portal-panel"><h2>Notifications</h2><div className="compact-list">{(dashboard?.notifications || []).slice(0, 12).map((item) => <div key={String(item.id)}><span><strong>{String(item.title)}</strong><small>{String(item.message)} · {formatDate(item.created_at)}</small></span></div>)}{!dashboard?.notifications?.length ? <p className="empty-copy">No notifications.</p> : null}</div></section>
    </div>
  )
}
