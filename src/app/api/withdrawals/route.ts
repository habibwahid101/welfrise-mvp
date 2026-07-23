import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { mapSafeError } from '@/lib/safe-errors'
import { enforceRateLimit, requestActorKey } from '@/lib/rate-limit'

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

  try {
    await enforceRateLimit(supabase, 'withdrawal', await requestActorKey(request, user.id))
    const { data, error } = await supabase.rpc('create_withdrawal_request_v2', {
      p_gross_amount: grossAmount, p_wallet_address: walletAddress.toLowerCase(),
      p_idempotency_key: request.headers.get('idempotency-key') || crypto.randomUUID(),
    })
    if (error) throw error
    return NextResponse.json({ ok: true, withdrawal: Array.isArray(data) ? data[0] : data })
  } catch (error) { const safe = mapSafeError(error, 'withdrawals.create'); return NextResponse.json({ error: safe.message }, { status: safe.status }) }
}
