import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const PACKAGE_SLOTS: Record<number, number> = { 10: 1, 20: 2, 50: 5, 100: 10 }

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const payerIdentifier = String(body?.payerIdentifier || '').trim()
  const amount = Number(body?.amount)
  const slots = Number(body?.slots)
  const level = Number(body?.level)
  const cycle = Math.max(1, Number(body?.cycle) || 1)

  if (!payerIdentifier) return NextResponse.json({ error: 'Wallet owner identifier is required' }, { status: 400 })
  if (!PACKAGE_SLOTS[amount] || PACKAGE_SLOTS[amount] !== slots) {
    return NextResponse.json({ error: 'Invalid package' }, { status: 400 })
  }
  if (!Number.isInteger(level) || level < 1 || level > 5) {
    return NextResponse.json({ error: 'Invalid level' }, { status: 400 })
  }

  const { data, error } = await supabase.rpc('create_user_wallet_payment_request', {
    p_payer_identifier: payerIdentifier,
    p_amount: amount,
    p_slots: slots,
    p_level: level,
    p_cycle: cycle,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true, request: Array.isArray(data) ? data[0] : data })
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
    const { data, error } = await supabase.rpc('cancel_user_wallet_payment_request', { p_request_id: requestId })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ ok: true, status: data })
  }
  if (!['approve', 'decline'].includes(action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  const { data, error } = await supabase.rpc('respond_user_wallet_payment_request', {
    p_request_id: requestId,
    p_decision: action,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true, status: data })
}
