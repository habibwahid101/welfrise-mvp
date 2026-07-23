import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { mapSafeError } from '@/lib/safe-errors'
import { enforceRateLimit, requestActorKey } from '@/lib/rate-limit'
import { calculatePaymentPackage } from '@/lib/payment-package'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const payerIdentifier = String(body?.payerIdentifier || '').trim()
  const paymentPackage = calculatePaymentPackage(body?.slots)
  const level = Number(body?.level)

  if (!payerIdentifier) return NextResponse.json({ error: 'Wallet owner identifier is required' }, { status: 400 })
  if (!paymentPackage) {
    return NextResponse.json({ error: 'Invalid package' }, { status: 400 })
  }
  const { amount, slots } = paymentPackage
  if (body && Object.prototype.hasOwnProperty.call(body, 'amount') && Number(body.amount) !== amount) {
    return NextResponse.json({ error: 'Invalid package' }, { status: 400 })
  }
  if (!Number.isInteger(level) || level < 1 || level > 5) {
    return NextResponse.json({ error: 'Invalid level' }, { status: 400 })
  }

  try {
    await enforceRateLimit(supabase, 'payment_create', await requestActorKey(request, user.id))
    const { data, error } = await supabase.rpc('create_user_wallet_payment_request_v2', {
      p_payer_identifier: payerIdentifier, p_amount: amount, p_slots: slots, p_level: level,
      p_idempotency_key: request.headers.get('idempotency-key') || crypto.randomUUID(),
    })
    if (error) throw error
    return NextResponse.json({ ok: true, request: Array.isArray(data) ? data[0] : data })
  } catch (error) {
    const safe = mapSafeError(error, 'payments.user-wallet.create')
    return NextResponse.json({ error: safe.message }, { status: safe.status })
  }
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const requestId = String(body?.requestId || '')
  const action = String(body?.action || '')
  if (!/^[0-9a-fA-F-]{36}$/.test(requestId)) {
    return NextResponse.json({ error: 'Invalid request ID' }, { status: 400 })
  }

  if (action === 'cancel') {
    try {
      await enforceRateLimit(supabase, 'authorization', await requestActorKey(request, user.id))
      const { data, error } = await supabase.rpc('cancel_user_wallet_payment_request', { p_request_id: requestId })
      if (error) throw error
      return NextResponse.json({ ok: true, status: data })
    } catch (error) { const safe = mapSafeError(error, 'payments.user-wallet.cancel'); return NextResponse.json({ error: safe.message }, { status: safe.status }) }
  }
  if (!['approve', 'decline'].includes(action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  try {
    await enforceRateLimit(supabase, 'authorization', await requestActorKey(request, user.id))
    const { data, error } = await supabase.rpc('respond_user_wallet_payment_request_v2', {
      p_request_id: requestId, p_decision: action,
      p_idempotency_key: request.headers.get('idempotency-key') || crypto.randomUUID(),
    })
    if (error) throw error
    return NextResponse.json({ ok: true, status: data })
  } catch (error) { const safe = mapSafeError(error, 'payments.user-wallet.respond'); return NextResponse.json({ error: safe.message }, { status: safe.status }) }
}
