import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const grossAmount = money(Number(body?.grossAmount))
  const walletAddress = String(body?.walletAddress || '').trim()

  if (!Number.isFinite(grossAmount) || grossAmount < 10 || grossAmount > 100) {
    return NextResponse.json({ error: 'Withdrawal amount must be between $10 and $100' }, { status: 400 })
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    return NextResponse.json({ error: 'Invalid BEP20 wallet address' }, { status: 400 })
  }

  const { data, error } = await supabase.rpc('create_withdrawal_request', {
    p_gross_amount: grossAmount,
    p_wallet_address: walletAddress,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true, withdrawal: Array.isArray(data) ? data[0] : data })
}
