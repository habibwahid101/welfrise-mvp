'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') redirect('/app')
  return { supabase, user }
}

function text(formData: FormData, key: string) {
  return String(formData.get(key) || '').trim()
}

export async function createReceivingWallet(formData: FormData) {
  const { supabase } = await requireAdmin()
  const { error } = await supabase.rpc('admin_create_receiving_wallet', {
    p_internal_label: text(formData, 'internalLabel'),
    p_wallet_address: text(formData, 'walletAddress'),
    p_capacity_limit: Number(formData.get('capacityLimit') || 10000),
    p_priority: Number(formData.get('priority') || 100),
    p_token: 'USDT',
    p_network: 'BEP20',
  })
  if (error) throw new Error(error.message)
  revalidatePath('/admin')
}

export async function updateReceivingWalletStatus(formData: FormData) {
  const { supabase } = await requireAdmin()
  const { error } = await supabase.rpc('admin_set_receiving_wallet_status', {
    p_wallet_id: text(formData, 'id'),
    p_status: text(formData, 'status'),
  })
  if (error) throw new Error(error.message)
  revalidatePath('/admin')
}

export async function reviewBinancePayment(formData: FormData) {
  const { supabase } = await requireAdmin()
  const { error } = await supabase.rpc('review_binance_payment', {
    p_request_id: text(formData, 'id'),
    p_decision: text(formData, 'decision'),
    p_note: text(formData, 'note') || null,
  })
  if (error) throw new Error(error.message)
  revalidatePath('/admin')
}

export async function adjustWalletBalance(formData: FormData) {
  const { supabase } = await requireAdmin()
  const { error } = await supabase.rpc('admin_adjust_wallet_balance', {
    p_user_identifier: text(formData, 'userIdentifier'),
    p_amount: Number(formData.get('amount')),
    p_reason: text(formData, 'reason'),
  })
  if (error) throw new Error(error.message)
  revalidatePath('/admin')
}

export async function reviewWithdrawal(formData: FormData) {
  const { supabase } = await requireAdmin()
  const decision = text(formData, 'decision')
  const { error } = await supabase.rpc('review_withdrawal_request', {
    p_withdrawal_id: text(formData, 'id'),
    p_decision: decision,
    p_payout_tx_hash: text(formData, 'payoutTxHash') || null,
  })
  if (error) throw new Error(error.message)
  revalidatePath('/admin')
}

export async function updateKycStatus(formData: FormData) {
  const { supabase, user } = await requireAdmin()
  const id = text(formData, 'id')
  const userId = text(formData, 'userId')
  const status = text(formData, 'status')
  const reviewNote = text(formData, 'reviewNote') || null
  if (!['pending', 'approved', 'rejected', 'held'].includes(status)) throw new Error('Invalid KYC status')

  const { error } = await supabase.from('kyc_submissions').update({
    status,
    review_note: reviewNote,
    reviewed_at: new Date().toISOString(),
    reviewed_by: user.id,
  }).eq('id', id)
  if (error) throw new Error(error.message)

  const { error: profileError } = await supabase.from('profiles').update({ kyc_status: status }).eq('id', userId)
  if (profileError) throw new Error(profileError.message)

  await supabase.from('admin_audit_log').insert({
    admin_id: user.id,
    action: 'kyc_status_updated',
    entity_type: 'kyc_submission',
    entity_id: id,
    metadata: { status, userId, reviewNote },
  })
  revalidatePath('/admin')
}
