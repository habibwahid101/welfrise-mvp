import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { mapSafeError } from '@/lib/safe-errors'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await supabase.rpc('welfrise_expire_stale_payment_requests')

  const [profileResult, walletResult, ledgerResult, binanceResult, incomingResult, outgoingResult, slotsResult, notificationsResult, withdrawalsResult] = await Promise.all([
    supabase.from('profiles').select('full_name,email,referral_code,kyc_status,highest_unlocked_level,championship_cycle,championship_status').eq('id', user.id).single(),
    supabase.from('wallet_accounts').select('available_balance,held_balance,updated_at').eq('user_id', user.id).maybeSingle(),
    supabase.from('wallet_ledger').select('id,direction,amount,balance_after,entry_type,description,created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(30),
    supabase.from('binance_payment_requests').select('id,amount,slots,level_id,championship_cycle,token,network,status,expires_at,created_at,tx_hash,assigned_wallet_address').eq('participant_id', user.id).order('created_at', { ascending: false }).limit(20),
    supabase.from('wallet_payment_requests').select('id,participant_id,payer_id,participant_display,payer_display,amount,slots,level_id,championship_cycle,status,expires_at,created_at').eq('payer_id', user.id).order('created_at', { ascending: false }).limit(20),
    supabase.from('wallet_payment_requests').select('id,participant_id,payer_id,participant_display,payer_display,amount,slots,level_id,championship_cycle,status,expires_at,created_at').eq('participant_id', user.id).order('created_at', { ascending: false }).limit(20),
    supabase.from('participation_slots').select('id,level_id,championship_cycle,level_position,status,payout_amount,created_at,completed_at,payment_method').eq('participant_id', user.id).order('created_at', { ascending: false }).limit(50),
    supabase.from('notifications').select('id,title,message,notification_type,is_read,created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(30),
    supabase.from('withdrawals').select('id,gross_amount,fee_amount,net_amount,wallet_address,status,created_at,payout_tx_hash').eq('user_id', user.id).order('created_at', { ascending: false }).limit(20),
  ])

  const error = profileResult.error || walletResult.error || ledgerResult.error || binanceResult.error || incomingResult.error || outgoingResult.error || slotsResult.error || notificationsResult.error || withdrawalsResult.error
  if (error) { const safe = mapSafeError(error, 'payments.dashboard'); return NextResponse.json({ error: safe.message }, { status: safe.status }) }

  return NextResponse.json({
    user: { id: user.id, email: user.email },
    profile: profileResult.data,
    wallet: walletResult.data || { available_balance: 0, held_balance: 0 },
    ledger: ledgerResult.data || [],
    binancePayments: binanceResult.data || [],
    incomingWalletRequests: incomingResult.data || [],
    outgoingWalletRequests: outgoingResult.data || [],
    slots: slotsResult.data || [],
    notifications: notificationsResult.data || [],
    withdrawals: withdrawalsResult.data || [],
  })
}
