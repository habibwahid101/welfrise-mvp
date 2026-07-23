import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { mapSafeError } from '@/lib/safe-errors'
import { enforceRateLimit, requestActorKey } from '@/lib/rate-limit'

const PACKAGE_SLOTS: Record<number, number> = { 10: 1, 20: 2, 50: 5, 100: 10 }
const BINANCE_UNAVAILABLE_MESSAGE = 'Binance payment is temporarily unavailable. Please try again later or use Pay by User Wallet.'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const amount = Number(body?.amount)
  const slots = Number(body?.slots)
  const level = Number(body?.level)

  if (!PACKAGE_SLOTS[amount] || PACKAGE_SLOTS[amount] !== slots) {
    return NextResponse.json({ error: 'Invalid package' }, { status: 400 })
  }
  if (!Number.isInteger(level) || level < 1 || level > 5) {
    return NextResponse.json({ error: 'Invalid level' }, { status: 400 })
  }

  try {
    await enforceRateLimit(supabase, 'payment_create', await requestActorKey(request, user.id))
    const idempotencyKey = request.headers.get('idempotency-key') || crypto.randomUUID()
    const { data, error } = await supabase.rpc('create_binance_payment_request_v2', {
      p_amount: amount, p_slots: slots, p_level: level, p_idempotency_key: idempotencyKey,
    })
    if (error) throw error
    const assigned = Array.isArray(data) ? data[0] : data
    if (!assigned) return NextResponse.json({ error: BINANCE_UNAVAILABLE_MESSAGE }, { status: 503 })
    return NextResponse.json({ ok: true, payment: assigned })
  } catch (error) {
    const safe = mapSafeError(error, 'payments.binance.request')
    return NextResponse.json({ error: safe.message }, { status: safe.status })
  }
}
