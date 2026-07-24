'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ALLOWED_SLOT_COUNTS, SLOT_PRICE_USD } from '@/lib/payment-package'

type Dashboard = {
  user?: { id?: string; email?: string }
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
  slots: number | string
  level_id: number | string
  expires_at: string
}

type PaymentDetails = {
  level: unknown
  slots: unknown
  amount: unknown
}

const BEP20_WALLET_PATTERN = /^0x[a-fA-F0-9]{40}$/
const ACTIVE_BINANCE_STATUSES = new Set(['awaiting_payment', 'submitted', 'held'])

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

function formatStatus(value: unknown) {
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

function notificationPaymentDetails(item: Record<string, unknown>, dashboard: Dashboard | null): PaymentDetails | null {
  if (!dashboard) return null
  const referenceId = String(item.reference_id || '')
  const referenceType = String(item.reference_type || '')
  if (!referenceId) return null

  if (['binance_payment_request', 'binance_wallet'].includes(referenceType)) {
    const request = dashboard.binancePayments.find((candidate) => String(candidate.id) === referenceId)
    return request ? { level: request.level_id, slots: request.slots, amount: request.amount } : null
  }
  if (['wallet_payment_request', 'user_wallet'].includes(referenceType)) {
    const requests = [...dashboard.incomingWalletRequests, ...dashboard.outgoingWalletRequests]
    const request = requests.find((candidate) => String(candidate.id) === referenceId)
    return request ? { level: request.level_id, slots: request.slots, amount: request.amount } : null
  }
  if (referenceType === 'participation_slot') {
    const slot = dashboard.slots.find((candidate) => String(candidate.id) === referenceId)
    return slot ? { level: slot.level_id, slots: 1, amount: SLOT_PRICE_USD } : null
  }
  return null
}

async function jsonRequest(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || 'Request failed')
  return body
}

export default function PaymentCenter() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [method, setMethod] = useState<'binance' | 'user-wallet'>('binance')
  const [level, setLevel] = useState(1)
  const [slotCount, setSlotCount] = useState(1)
  const [payerIdentifier, setPayerIdentifier] = useState('')
  const [assigned, setAssigned] = useState<AssignedPayment | null>(null)
  const [txHash, setTxHash] = useState('')
  const [proof, setProof] = useState<File | null>(null)
  const [withdrawalAmount, setWithdrawalAmount] = useState(10)
  const [withdrawalAddress, setWithdrawalAddress] = useState('')
  const mutationBusyRef = useRef(false)
  const mutationKeysRef = useRef(new Map<string, string>())

  function mutationHeaders(operation: string, contentType?: string) {
    const existing = mutationKeysRef.current.get(operation)
    const idempotencyKey = existing || crypto.randomUUID()
    if (!existing) mutationKeysRef.current.set(operation, idempotencyKey)
    return { ...(contentType ? { 'content-type': contentType } : {}), 'idempotency-key': idempotencyKey }
  }

  function clearMutationKey(operation: string) {
    mutationKeysRef.current.delete(operation)
  }

  const totalAmount = slotCount * SLOT_PRICE_USD

  const load = useCallback(async () => {
    try {
      const data = await jsonRequest('/api/payments/dashboard', { cache: 'no-store' })
      setDashboard(data)
      const unlockedLevel = Math.max(1, Number(data.profile?.highest_unlocked_level || 1))
      setLevel((current) => Math.min(Math.max(1, current), unlockedLevel))
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
    const unlockedLevel = Number(dashboard?.profile?.highest_unlocked_level || 1)
    const validSlots = ALLOWED_SLOT_COUNTS.some((allowed) => allowed === slotCount)
    const validLevel = Number.isInteger(level) && level >= 1 && level <= unlockedLevel
    if (mutationBusyRef.current) return
    if (!validSlots || !validLevel) {
      setError('Select a valid unlocked level and number of slots.')
      return
    }
    if (method === 'user-wallet' && !payerIdentifier.trim()) {
      setError('Enter the wallet owner ID, referral code, or email.')
      return
    }

    mutationBusyRef.current = true
    resetNotice()
    setBusy('create')
    const operation = method === 'binance'
      ? `binance-request:${level}:${slotCount}`
      : `wallet-request:${payerIdentifier.trim().toLowerCase()}:${level}:${slotCount}`
    try {
      if (method === 'binance') {
        const result = await jsonRequest('/api/payments/binance/request', {
          method: 'POST', headers: mutationHeaders(operation, 'application/json'),
          body: JSON.stringify({ slots: slotCount, level }),
        })
        clearMutationKey(operation)
        setAssigned(result.payment)
        setMessage(`Payment request created. Level: ${level}. Slots: ${slotCount}. Amount: ${money(totalAmount)}.`)
      } else {
        const result = await jsonRequest('/api/payments/user-wallet', {
          method: 'POST', headers: mutationHeaders(operation, 'application/json'),
          body: JSON.stringify({ payerIdentifier, slots: slotCount, level }),
        })
        clearMutationKey(operation)
        setMessage(`Authorization request sent to ${result.request?.payer_display || 'the wallet owner'}. Level: ${level}. Slots: ${slotCount}. Amount: ${money(totalAmount)}.`)
        setPayerIdentifier('')
        await load()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create payment request')
    } finally {
      mutationBusyRef.current = false
      setBusy('')
    }
  }

  async function submitBinanceProof(event: React.FormEvent) {
    event.preventDefault()
    if (!assigned || !proof || mutationBusyRef.current) return
    mutationBusyRef.current = true
    resetNotice()
    setBusy('proof')
    const operation = `binance-proof:${assigned.request_id}:${txHash.trim().toLowerCase()}`
    try {
      const form = new FormData()
      form.set('requestId', assigned.request_id)
      form.set('txHash', txHash)
      form.set('proof', proof)
      await jsonRequest('/api/payments/binance/submit', { method: 'POST', headers: mutationHeaders(operation), body: form })
      clearMutationKey(operation)
      setMessage(`Payment proof submitted. Level: ${assigned.level_id}. Slots: ${assigned.slots}. Amount: ${money(assigned.amount)}.`)
      setAssigned(null)
      setTxHash('')
      setProof(null)
      await load()
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Unable to submit payment proof'
      setError(`${reason} Level: ${assigned.level_id}. Slots: ${assigned.slots}. Amount: ${money(assigned.amount)}.`)
    } finally {
      mutationBusyRef.current = false
      setBusy('')
    }
  }

  async function walletRequestAction(requestId: string, action: 'approve' | 'decline' | 'cancel') {
    if (mutationBusyRef.current) return
    const paymentRequest = [...(dashboard?.incomingWalletRequests || []), ...(dashboard?.outgoingWalletRequests || [])]
      .find((item) => String(item.id) === requestId)
    const paymentContext = paymentRequest
      ? ` Level: ${String(paymentRequest.level_id)}. Slots: ${String(paymentRequest.slots)}. Amount: ${money(paymentRequest.amount)}.`
      : ''
    mutationBusyRef.current = true
    resetNotice()
    setBusy(requestId + action)
    const operation = `wallet-response:${requestId}:${action}`
    try {
      const result = await jsonRequest('/api/payments/user-wallet', {
        method: 'PATCH', headers: mutationHeaders(operation, 'application/json'),
        body: JSON.stringify({ requestId, action }),
      })
      clearMutationKey(operation)
      setMessage(`Request ${String(result.status).replaceAll('_', ' ')}.${paymentContext}`)
      await load()
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Unable to update request'
      setError(`${reason}${paymentContext}`)
    } finally {
      mutationBusyRef.current = false
      setBusy('')
    }
  }

  async function requestWithdrawal(event: React.FormEvent) {
    event.preventDefault()
    if (withdrawalDisabledReason || mutationBusyRef.current) return
    mutationBusyRef.current = true
    resetNotice()
    setBusy('withdrawal')
    const operation = `withdrawal:${withdrawalAmount}:${withdrawalAddress.trim().toLowerCase()}`
    try {
      const result = await jsonRequest('/api/withdrawals', {
        method: 'POST', headers: mutationHeaders(operation, 'application/json'),
        body: JSON.stringify({ grossAmount: withdrawalAmount, walletAddress: withdrawalAddress }),
      })
      clearMutationKey(operation)
      setMessage(`Withdrawal submitted: ${money(result.withdrawal?.gross_amount)} gross, ${money(result.withdrawal?.fee_amount)} fee, ${money(result.withdrawal?.net_amount)} net.`)
      setWithdrawalAddress('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit withdrawal')
    } finally {
      mutationBusyRef.current = false
      setBusy('')
    }
  }

  if (loading && !dashboard) return <section className="portal-panel"><p>Loading payment center…</p></section>

  const available = asNumber(dashboard?.wallet?.available_balance)
  const held = asNumber(dashboard?.wallet?.held_balance)
  const unlocked = Number(dashboard?.profile?.highest_unlocked_level || 1)
  const participant = dashboard?.profile?.full_name || dashboard?.profile?.email || dashboard?.user?.email || 'Current participant'
  const kycStatus = String(dashboard?.profile?.kyc_status || 'not_submitted').toLowerCase()
  const selectedSlotsValid = ALLOWED_SLOT_COUNTS.some((allowed) => allowed === slotCount)
  const selectedLevelValid = Number.isInteger(level) && level >= 1 && level <= unlocked
  const paymentDisabledReason = busy
    ? 'A payment action is already processing.'
    : !selectedLevelValid
      ? 'Select an unlocked level.'
      : !selectedSlotsValid
        ? 'Select 1, 2, 5, or 10 slots.'
        : method === 'user-wallet' && !payerIdentifier.trim()
          ? 'Enter the wallet owner ID, referral code, or email.'
          : ''
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
  const activeBinance = (dashboard?.binancePayments || []).filter((item) => ACTIVE_BINANCE_STATUSES.has(String(item.status)))

  return (
    <div className="portal-stack">
      {message ? <div className="notice success" role="status" aria-live="polite">{message}</div> : null}
      {error ? <div className="notice error" role="alert" aria-live="assertive">{error}</div> : null}

      <section className="portal-metrics">
        <div><span>Available wallet</span><strong>{money(available)}</strong></div>
        <div><span>Held balance</span><strong>{money(held)}</strong></div>
        <div><span>Unlocked level</span><strong>Level {unlocked}</strong></div>
        <div><span>KYC status</span><strong>{formatStatus(kycStatus)}</strong></div>
      </section>

      <section className="portal-panel payment-create-panel">
        <div className="panel-title-row">
          <div><h2>Purchase participation slots</h2><p>One participation slot costs $10. Commission always follows the participant’s registered referrer.</p></div>
          <button className="ghost-button" type="button" disabled={Boolean(busy)} onClick={() => void load()}>Refresh</button>
        </div>

        <div className="method-switch" role="group" aria-label="Payment method">
          <button type="button" disabled={Boolean(busy)} className={method === 'binance' ? 'active' : ''} onClick={() => { setMethod('binance'); setAssigned(null) }}>Pay by Binance Wallet</button>
          <button type="button" disabled={Boolean(busy)} className={method === 'user-wallet' ? 'active' : ''} onClick={() => { setMethod('user-wallet'); setAssigned(null) }}>Pay by User Wallet</button>
        </div>

        <div className="form-grid payment-fields">
          <label>Level<select value={level} disabled={Boolean(busy)} onChange={(event) => setLevel(Number(event.target.value))}>{Array.from({ length: unlocked }, (_, index) => <option key={index + 1} value={index + 1}>Level {index + 1}</option>)}</select></label>
          <label>Number of slots<select value={slotCount} disabled={Boolean(busy)} onChange={(event) => setSlotCount(Number(event.target.value))}>{ALLOWED_SLOT_COUNTS.map((count) => <option key={count} value={count}>{count} slot{count > 1 ? 's' : ''}</option>)}</select></label>
          <label>Total amount<input value={money(totalAmount)} readOnly aria-readonly="true" /></label>
          {method === 'user-wallet' ? <label className="payment-owner-field">Wallet owner ID, referral code, or email<input value={payerIdentifier} disabled={Boolean(busy)} onChange={(event) => setPayerIdentifier(event.target.value)} placeholder="Enter wallet owner identifier" required /></label> : null}
        </div>
        <span className="sr-only" aria-live="polite">Total amount {money(totalAmount)}</span>

        <section className="payment-summary" aria-labelledby="payment-summary-title">
          <h3 id="payment-summary-title">Payment summary</h3>
          <dl className="payment-summary-grid">
            <div><dt>Participant</dt><dd>{participant}</dd></div>
            <div><dt>Level</dt><dd>Level {level}</dd></div>
            <div><dt>Number of slots</dt><dd>{slotCount}</dd></div>
            <div><dt>{method === 'binance' ? 'Amount to pay' : 'Amount to authorize'}</dt><dd>{money(totalAmount)}</dd></div>
            <div><dt>{method === 'binance' ? 'Payment method' : 'Payment source'}</dt><dd>{method === 'binance' ? 'Binance Wallet' : payerIdentifier.trim() || 'Not entered'}</dd></div>
          </dl>
          <p><strong>Commission:</strong> Commission goes to the participant’s registered referrer.</p>
          {method === 'user-wallet' ? <p><strong>Important:</strong> The wallet owner supplies the balance only. The wallet owner does not receive the referral commission unless that wallet owner is independently the participant’s registered referrer.</p> : null}
          <p>{method === 'binance'
            ? 'A secure payment address will be assigned for this payment request.'
            : 'The wallet owner receives Approve or Decline. No deduction, slot, or commission occurs before approval.'}</p>
        </section>

        <div className="payment-submit">
          <button className="primary-button portal-action" type="button" disabled={Boolean(paymentDisabledReason)} onClick={() => void createPayment()}>{busy === 'create' ? (method === 'binance' ? 'Generating address…' : 'Sending request…') : method === 'binance' ? 'Generate payment address' : 'Send authorization request'}</button>
          {paymentDisabledReason ? <p className="small-muted" role="status">{paymentDisabledReason}</p> : null}
        </div>
      </section>

      {assigned ? <section className="portal-panel assigned-card">
        <h2>Active Binance payment request</h2>
        <dl className="request-details">
          <div><dt>Level</dt><dd>Level {assigned.level_id}</dd></div>
          <div><dt>Number of slots</dt><dd>{assigned.slots}</dd></div>
          <div><dt>Amount</dt><dd>{money(assigned.amount)} {assigned.token}</dd></div>
          <div><dt>Network</dt><dd>{assigned.network}</dd></div>
        </dl>
        <p>Send the exact amount to the secure address below.</p>
        <div className="copy-row"><code>{assigned.wallet_address}</code><button type="button" onClick={() => void navigator.clipboard.writeText(assigned.wallet_address)}>Copy</button></div>
        <p className="small-muted">Expires: {formatDate(assigned.expires_at)}. The assigned address will not change during this request.</p>
        <form className="form-grid single-column" onSubmit={submitBinanceProof}>
          <label>Transaction hash<input value={txHash} disabled={Boolean(busy)} onChange={(event) => setTxHash(event.target.value)} pattern="^0x[a-fA-F0-9]{64}$" title="Enter a 0x-prefixed 66-character transaction hash." required /></label>
          <label>Payment proof<input type="file" disabled={Boolean(busy)} accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => setProof(event.target.files?.[0] || null)} required /><span className="small-muted">JPG, PNG, WebP, or PDF up to 4 MB.</span></label>
          <button className="primary-button" disabled={Boolean(busy)}>{busy === 'proof' ? 'Submitting…' : 'Submit payment proof'}</button>
        </form>
      </section> : null}

      <section className="portal-panel">
        <h2>Active Binance payment requests</h2>
        <div className="request-list">{activeBinance.length ? activeBinance.map((item) => <article key={String(item.id)} className="request-card"><div>
          <dl className="request-details">
            <div><dt>Level</dt><dd>Level {String(item.level_id)}</dd></div>
            <div><dt>Slots</dt><dd>{String(item.slots)}</dd></div>
            <div><dt>Amount</dt><dd>{money(item.amount)} {String(item.token || 'USDT')}</dd></div>
            <div><dt>Status</dt><dd>{formatStatus(item.status)}</dd></div>
          </dl>
          <small>Expires {formatDate(item.expires_at)}</small>
          {item.assigned_wallet_address ? <code className="request-address">{String(item.assigned_wallet_address)}</code> : null}
        </div></article>) : <p className="empty-copy">No active Binance payment requests.</p>}</div>
      </section>

      <section className="portal-grid-two">
        <div className="portal-panel">
          <h2>Requests needing your approval</h2>
          <div className="request-list">{(dashboard?.incomingWalletRequests || []).length ? dashboard!.incomingWalletRequests.map((item) => {
            const pending = item.status === 'pending'
            const requestId = String(item.id)
            return <article key={requestId} className="request-card"><div>
              <dl className="request-details">
                <div><dt>Participant</dt><dd>{String(item.participant_display || 'Participant')}</dd></div>
                <div><dt>Level</dt><dd>Level {String(item.level_id)}</dd></div>
                <div><dt>Slots</dt><dd>{String(item.slots)}</dd></div>
                <div><dt>Amount requested</dt><dd>{money(item.amount)}</dd></div>
                <div><dt>Current available balance</dt><dd>{money(available)}</dd></div>
                <div><dt>Balance after approval</dt><dd>{available >= asNumber(item.amount) ? money(available - asNumber(item.amount)) : 'Insufficient balance'}</dd></div>
                <div className="detail-wide"><dt>Commission</dt><dd>Follows the participant’s registered referrer after approval.</dd></div>
              </dl>
              <small>{formatStatus(item.status)} · expires {formatDate(item.expires_at)}</small>
            </div>{pending ? <div className="inline-actions"><button disabled={Boolean(busy)} onClick={() => { if (window.confirm(`Approve ${money(item.amount)} for ${String(item.participant_display || 'this participant')}? Level ${String(item.level_id)}, ${String(item.slots)} slot(s). Your wallet will be debited.`)) void walletRequestAction(requestId, 'approve') }}>{busy === requestId + 'approve' ? 'Approving…' : 'Approve'}</button><button className="danger-button" disabled={Boolean(busy)} onClick={() => void walletRequestAction(requestId, 'decline')}>{busy === requestId + 'decline' ? 'Declining…' : 'Decline'}</button></div> : null}</article>
          }) : <p className="empty-copy">No wallet authorization requests.</p>}</div>
        </div>

        <div className="portal-panel">
          <h2>Your outgoing wallet requests</h2>
          <div className="request-list">{(dashboard?.outgoingWalletRequests || []).length ? dashboard!.outgoingWalletRequests.map((item) => {
            const requestId = String(item.id)
            return <article key={requestId} className="request-card"><div>
              <dl className="request-details">
                <div><dt>Wallet owner</dt><dd>{String(item.payer_display || 'Wallet owner')}</dd></div>
                <div><dt>Level</dt><dd>Level {String(item.level_id)}</dd></div>
                <div><dt>Slots</dt><dd>{String(item.slots)}</dd></div>
                <div><dt>Amount</dt><dd>{money(item.amount)}</dd></div>
                <div><dt>Status</dt><dd>{formatStatus(item.status)}</dd></div>
              </dl>
              <small>{formatDate(item.created_at)}</small>
            </div>{item.status === 'pending' ? <button className="danger-button" disabled={Boolean(busy)} onClick={() => void walletRequestAction(requestId, 'cancel')}>{busy === requestId + 'cancel' ? 'Cancelling…' : 'Cancel'}</button> : null}</article>
          }) : <p className="empty-copy">No outgoing requests.</p>}</div>
        </div>
      </section>

      <section className="portal-panel">
        <h2>Withdraw funds</h2>
        <p>Approved KYC is required. The fee is 5% of the gross request and the daily gross limit is $100.</p>
        <form className="form-grid" onSubmit={requestWithdrawal}>
          <label>Gross amount<input type="number" min={10} max={100} step="0.01" value={withdrawalAmount} onChange={(event) => setWithdrawalAmount(Number(event.target.value))} /></label>
          <label>BEP20 wallet address<input value={withdrawalAddress} onChange={(event) => setWithdrawalAddress(event.target.value)} placeholder="0x…" required /></label>
          <div className="withdrawal-preview"><span>Gross {money(withdrawalAmount)}</span><span>Fee {money(fee)}</span><strong>Net {money(net)}</strong></div>
          <div className="withdrawal-submit">
            <button className="primary-button" disabled={Boolean(withdrawalDisabledReason)}>{busy === 'withdrawal' ? 'Submitting…' : 'Request withdrawal'}</button>
            {withdrawalDisabledReason ? <p className="small-muted" role="status">{withdrawalDisabledReason}</p> : null}
          </div>
        </form>
      </section>

      <section className="portal-grid-two">
        <div className="portal-panel"><h2>Recent participation slots</h2><div className="compact-list">{(dashboard?.slots || []).slice(0, 12).map((item) => <div key={String(item.id)}><span><strong>Level {String(item.level_id)}</strong><small>Slots: 1 · Amount: {money(SLOT_PRICE_USD)} · Position {String(item.level_position)}</small></span><strong>{formatStatus(item.status)}{asNumber(item.payout_amount) ? ` · ${money(item.payout_amount)} payout` : ''}</strong></div>)}{!dashboard?.slots?.length ? <p className="empty-copy">No server-approved slots yet.</p> : null}</div></div>
        <div className="portal-panel"><h2>Wallet history</h2><div className="compact-list">{(dashboard?.ledger || []).slice(0, 12).map((item) => <div key={String(item.id)}><span>{String(item.description)}<small>{formatDate(item.created_at)}</small></span><strong className={item.direction === 'credit' ? 'positive' : 'negative'}>Amount: {item.direction === 'credit' ? '+' : '-'}{money(item.amount)}</strong></div>)}{!dashboard?.ledger?.length ? <p className="empty-copy">No wallet entries yet.</p> : null}</div></div>
      </section>

      <section className="portal-panel"><h2>Notifications</h2><div className="compact-list">{(dashboard?.notifications || []).slice(0, 12).map((item) => {
        const details = notificationPaymentDetails(item, dashboard)
        return <div key={String(item.id)}><span><strong>{String(item.title)}</strong><small>{String(item.message)}</small>{details ? <small>Level: {String(details.level)} · Slots: {String(details.slots)} · Amount: {money(details.amount)}</small> : null}<small>{formatDate(item.created_at)}</small></span></div>
      })}{!dashboard?.notifications?.length ? <p className="empty-copy">No notifications.</p> : null}</div></section>
    </div>
  )
}
