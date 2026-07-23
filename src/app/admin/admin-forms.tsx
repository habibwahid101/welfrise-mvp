'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import {
  adjustWalletBalance, createReceivingWallet, initialActionResult, reviewBinancePayment,
  reviewWithdrawal, updateKycStatus, updateReceivingWalletStatus,
} from './actions'

function useIdempotencyKey(state: typeof initialActionResult) {
  const keyRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (state.message && keyRef.current) keyRef.current.value = ''
  }, [state])
  function prepare() {
    if (keyRef.current && !keyRef.current.value) keyRef.current.value = crypto.randomUUID()
  }
  return { keyRef, prepare }
}

function Key({ inputRef }: { inputRef: React.RefObject<HTMLInputElement | null> }) {
  return <input ref={inputRef} type="hidden" name="idempotencyKey" defaultValue="" />
}

function Notice({ state }: { state: typeof initialActionResult }) {
  return state.message ? <div className={`action-notice ${state.success ? 'success' : 'error'}`} role={state.success ? 'status' : 'alert'} aria-live="polite">{state.message}</div> : null
}

function Submit({ children, value, danger = false, disabled = false, confirmText }: { children: React.ReactNode; value?: string; danger?: boolean; disabled?: boolean; confirmText?: string }) {
  const { pending } = useFormStatus()
  return <button className={danger ? 'danger-button' : ''} name={value ? 'decision' : undefined} value={value} disabled={pending || disabled} onClick={(event) => { if (confirmText && !window.confirm(confirmText)) event.preventDefault() }}>{pending ? 'Processing…' : children}</button>
}

export function MaskedValue({ value }: { value: string }) {
  const [shown, setShown] = useState(false)
  const display = shown || value.length < 16 ? value : `${value.slice(0, 8)}…${value.slice(-6)}`
  return <span className="masked-value"><code>{display}</code><button type="button" className="mini-button" onClick={() => setShown(!shown)}>{shown ? 'Mask' : 'Reveal'}</button><button type="button" className="mini-button" onClick={() => void navigator.clipboard.writeText(value)}>Copy</button></span>
}

export function ReceivingWalletForm({ enabled }: { enabled: boolean }) {
  const [state, action] = useActionState(createReceivingWallet, initialActionResult)
  const { keyRef, prepare } = useIdempotencyKey(state)
  return <form action={action} className="admin-form-row" onSubmit={prepare}><Key inputRef={keyRef} /><label>Internal label<input name="internalLabel" required minLength={2} maxLength={80} /></label><label>BEP20 address<input name="walletAddress" required pattern="^0x[0-9a-fA-F]{40}$" /></label><label>Capacity<input name="capacityLimit" type="number" min="0.01" step="0.01" defaultValue="10000" required /></label><label>Priority<input name="priority" type="number" min="1" step="1" defaultValue="100" required /></label><Submit disabled={!enabled}>Add wallet</Submit><Notice state={state} /></form>
}

export function WalletStatusForm({ id, current, enabled }: { id: string; current: string; enabled: boolean }) {
  const [state, action] = useActionState(updateReceivingWalletStatus, initialActionResult)
  const { keyRef, prepare } = useIdempotencyKey(state)
  return <form action={action} className="inline-admin-form" onSubmit={prepare}><Key inputRef={keyRef} /><input type="hidden" name="id" value={id} /><label className="sr-only" htmlFor={`wallet-${id}`}>Wallet status</label><select id={`wallet-${id}`} name="status" defaultValue={current}><option value="active">Active</option><option value="paused">Paused</option><option value="capacity_reached">Capacity reached</option><option value="disabled">Disabled</option></select><Submit disabled={!enabled}>Save</Submit><Notice state={state} /></form>
}

export function WalletAdjustmentForm({ enabled }: { enabled: boolean }) {
  const [state, action] = useActionState(adjustWalletBalance, initialActionResult)
  const { keyRef, prepare } = useIdempotencyKey(state)
  return <form action={action} className="admin-form-row wallet-adjustment" onSubmit={prepare}><Key inputRef={keyRef} /><label>User identifier<input name="userIdentifier" required /></label><label>Amount<input name="amount" type="number" step="0.01" required /></label><label>Audit reason<input name="reason" required minLength={5} /></label><Submit disabled={!enabled} confirmText="Apply this audited wallet adjustment?">Apply adjustment</Submit><Notice state={state} /></form>
}

export function KycReviewForm({ id, current, note, enabled }: { id: string; current: string; note: string; enabled: boolean }) {
  const [state, action] = useActionState(updateKycStatus, initialActionResult)
  const { keyRef, prepare } = useIdempotencyKey(state)
  return <form action={action} className="stack-admin-form" onSubmit={prepare}><Key inputRef={keyRef} /><input type="hidden" name="id" value={id} /><label>Status<select name="status" defaultValue={current}><option value="pending">Pending</option><option value="approved">Approved</option><option value="held">Under review</option><option value="rejected">Rejected</option></select></label><label>Review note<input name="reviewNote" defaultValue={note} /></label><Submit disabled={!enabled} confirmText="Save this KYC review decision?">Save review</Submit><Notice state={state} /></form>
}

export function WithdrawalReviewForm({ id, enabled }: { id: string; enabled: boolean }) {
  const [state, action] = useActionState(reviewWithdrawal, initialActionResult)
  const { keyRef, prepare } = useIdempotencyKey(state)
  return <form action={action} className="stack-admin-form" onSubmit={prepare}><Key inputRef={keyRef} /><input type="hidden" name="id" value={id} /><label>Payout transaction hash<input name="payoutTxHash" placeholder="Required to complete" /></label><div><Submit value="approve" disabled={!enabled} confirmText="Approve this withdrawal for payout?">Approve</Submit><Submit value="hold" disabled={!enabled}>Hold</Submit><Submit value="complete" disabled={!enabled} confirmText="Confirm the payout has completed on-chain?">Complete</Submit><Submit value="reject" danger disabled={!enabled} confirmText="Reject this withdrawal and release its held gross amount?">Reject</Submit></div><Notice state={state} /></form>
}

export function BinanceReviewForm({ id, amount, address, enabled }: { id: string; amount: string; address: string; enabled: boolean }) {
  const [state, action] = useActionState(reviewBinancePayment, initialActionResult)
  const { keyRef, prepare } = useIdempotencyKey(state)
  return <form action={action} className="stack-admin-form verification-form" onSubmit={prepare}><Key inputRef={keyRef} /><input type="hidden" name="id" value={id} /><label>Chain ID<input name="chainId" placeholder="Verified chain identifier" /></label><label>Verified token contract<input name="tokenContract" placeholder="0x… from approved config" /></label><label>Verified amount<input name="verifiedAmount" type="number" step="0.000001" defaultValue={amount} /></label><label>Verified recipient<input name="verifiedAddress" defaultValue={address} /></label><label>Block number<input name="blockNumber" type="number" min="1" step="1" /></label><label>Confirmation count<input name="confirmationCount" type="number" min="1" step="1" /></label><label>Verification source<input name="verificationSource" placeholder="Explorer/RPC source" /></label><label>Method<select name="verificationMethod" defaultValue="manual"><option value="manual">Manual</option><option value="automatic">Automatic</option></select></label><fieldset><legend>Required approval checklist</legend><label><input type="checkbox" name="transactionSuccess" /> Transaction successful</label><label><input type="checkbox" name="recipientMatches" /> Recipient matches</label><label><input type="checkbox" name="amountMatches" /> Amount matches</label><label><input type="checkbox" name="networkTokenMatches" /> Network and token match</label></fieldset><label>Review note<input name="note" /></label><div><Submit value="approve" disabled={!enabled} confirmText="Approve only after independently confirming every on-chain field. Continue?">Approve</Submit><Submit value="hold" disabled={!enabled}>Hold</Submit><Submit value="reject" danger disabled={!enabled} confirmText="Reject this payment proof?">Reject</Submit></div><Notice state={state} /></form>
}
