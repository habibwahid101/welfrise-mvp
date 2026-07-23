'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { errorMessage } from '@/lib/safe-errors'

export type ActionResult = { success: boolean; message: string; fieldErrors?: Record<string, string> }
export const initialActionResult: ActionResult = { success: false, message: '' }

function value(formData: FormData, key: string) { return String(formData.get(key) || '').trim() }
function checked(formData: FormData, key: string) { return formData.get(key) === 'on' }
function idempotency(formData: FormData) { return value(formData, 'idempotencyKey') || crypto.randomUUID() }

async function requireAdminAal2() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')
  const { data: profile, error } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (error || profile?.role !== 'admin') throw new Error('Admin access required')
  const { data: aal, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (aalError || aal?.currentLevel !== 'aal2') throw new Error('Admin MFA required')
  return { supabase, user }
}

async function execute(context: string, operation: () => Promise<void>): Promise<ActionResult> {
  try {
    await operation()
    revalidatePath('/admin')
    return { success: true, message: 'Saved successfully.' }
  } catch (error) {
    return { success: false, message: errorMessage(error, context) }
  }
}

export async function createReceivingWallet(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const label = value(formData, 'internalLabel')
  const address = value(formData, 'walletAddress')
  const capacity = Number(formData.get('capacityLimit'))
  const priority = Number(formData.get('priority'))
  const fieldErrors: Record<string, string> = {}
  if (label.length < 2 || label.length > 80) fieldErrors.internalLabel = 'Use 2–80 characters.'
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) fieldErrors.walletAddress = 'Enter a valid BEP20 address.'
  if (!Number.isFinite(capacity) || capacity <= 0) fieldErrors.capacityLimit = 'Capacity must be greater than zero.'
  if (!Number.isInteger(priority) || priority <= 0) fieldErrors.priority = 'Priority must be a positive integer.'
  if (Object.keys(fieldErrors).length) return { success: false, message: 'Correct the highlighted wallet fields.', fieldErrors }
  return execute('admin.receiving-wallet.create', async () => {
    const { supabase } = await requireAdminAal2()
    const { error } = await supabase.rpc('admin_create_receiving_wallet_v2', {
      p_internal_label: label, p_wallet_address: address.toLowerCase(), p_capacity_limit: capacity,
      p_priority: priority, p_idempotency_key: idempotency(formData),
    })
    if (error) throw error
  })
}

export async function updateReceivingWalletStatus(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return execute('admin.receiving-wallet.status', async () => {
    const { supabase } = await requireAdminAal2()
    const status = value(formData, 'status')
    if (!['active', 'paused', 'capacity_reached', 'disabled'].includes(status)) throw new Error('Invalid status')
    const { error } = await supabase.rpc('admin_set_receiving_wallet_status_v2', {
      p_wallet_id: value(formData, 'id'), p_status: status, p_idempotency_key: idempotency(formData),
    })
    if (error) throw error
  })
}

export async function reviewBinancePayment(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return execute('admin.binance.review', async () => {
    const { supabase } = await requireAdminAal2()
    const decision = value(formData, 'decision')
    if (!['approve', 'hold', 'reject'].includes(decision)) throw new Error('Invalid decision')
    const { error } = await supabase.rpc('review_binance_payment_v2', {
      p_request_id: value(formData, 'id'), p_decision: decision, p_note: value(formData, 'note') || null,
      p_chain_id: value(formData, 'chainId') || null,
      p_verified_token_contract: value(formData, 'tokenContract') || null,
      p_verified_amount: Number(formData.get('verifiedAmount') || 0),
      p_verified_receiving_address: value(formData, 'verifiedAddress') || null,
      p_transaction_success: checked(formData, 'transactionSuccess'),
      p_block_number: Number(formData.get('blockNumber') || 0),
      p_confirmation_count: Number(formData.get('confirmationCount') || 0),
      p_verification_source: value(formData, 'verificationSource') || null,
      p_verification_method: value(formData, 'verificationMethod') || 'manual',
      p_recipient_matches: checked(formData, 'recipientMatches'),
      p_amount_matches: checked(formData, 'amountMatches'),
      p_network_token_matches: checked(formData, 'networkTokenMatches'),
      p_idempotency_key: idempotency(formData),
    })
    if (error) throw error
  })
}

export async function adjustWalletBalance(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return execute('admin.wallet.adjust', async () => {
    const { supabase } = await requireAdminAal2()
    const amount = Number(formData.get('amount'))
    const reason = value(formData, 'reason')
    if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 100000) throw new Error('Invalid adjustment amount')
    if (reason.length < 5) throw new Error('A clear audit reason is required')
    const { error } = await supabase.rpc('admin_adjust_wallet_balance_v2', {
      p_user_identifier: value(formData, 'userIdentifier'), p_amount: amount, p_reason: reason,
      p_idempotency_key: idempotency(formData),
    })
    if (error) throw error
  })
}

export async function reviewWithdrawal(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return execute('admin.withdrawal.review', async () => {
    const { supabase } = await requireAdminAal2()
    const decision = value(formData, 'decision')
    if (!['approve', 'hold', 'reject', 'complete'].includes(decision)) throw new Error('Invalid decision')
    const { error } = await supabase.rpc('review_withdrawal_request_v2', {
      p_withdrawal_id: value(formData, 'id'), p_decision: decision,
      p_payout_tx_hash: value(formData, 'payoutTxHash') || null,
      p_idempotency_key: idempotency(formData),
    })
    if (error) throw error
  })
}

export async function updateKycStatus(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return execute('admin.kyc.review', async () => {
    const { supabase } = await requireAdminAal2()
    const status = value(formData, 'status')
    if (!['pending', 'approved', 'rejected', 'held'].includes(status)) throw new Error('Invalid KYC status')
    const { error } = await supabase.rpc('review_kyc_submission_v2', {
      p_submission_id: value(formData, 'id'), p_status: status,
      p_review_note: value(formData, 'reviewNote') || null, p_idempotency_key: idempotency(formData),
    })
    if (error) throw error
  })
}
