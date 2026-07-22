import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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

  const { data, error } = await supabase.rpc('create_binance_payment_request', {
    p_amount: amount,
    p_slots: slots,
    p_level: level,
  })

  if (error) {
    const unavailable = error.message.toLowerCase().includes('binance payment is temporarily unavailable')
    return NextResponse.json(
      { error: unavailable ? BINANCE_UNAVAILABLE_MESSAGE : error.message },
      { status: unavailable ? 503 : 400 },
    )
  }
  const assigned = Array.isArray(data) ? data[0] : data
  if (!assigned) return NextResponse.json({ error: BINANCE_UNAVAILABLE_MESSAGE }, { status: 503 })
  return NextResponse.json({ ok: true, payment: assigned })
}
