import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { mapSafeError } from '@/lib/safe-errors'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [{ data: profile, error: profileError }, { data: appState, error: stateError }] = await Promise.all([
    supabase.from('profiles').select('id,email,full_name,phone,referral_code,referral_code_used,kyc_status,highest_unlocked_level,championship_cycle,championship_status').eq('id', user.id).maybeSingle(),
    supabase.from('app_states').select('state, updated_at').eq('user_id', user.id).maybeSingle(),
  ])

  if (profileError || stateError) {
    const safe = mapSafeError(profileError || stateError, 'state.read')
    return NextResponse.json({ error: safe.message }, { status: safe.status })
  }

  return NextResponse.json({
    user: { id: user.id, email: user.email },
    profile,
    payload: appState?.state || null,
    updatedAt: appState?.updated_at || null,
  })
}

export async function PUT(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid state payload' }, { status: 400 })
  }

  const serialized = JSON.stringify(body)
  if (serialized.length > 2_000_000) {
    return NextResponse.json({ error: 'State payload is too large' }, { status: 413 })
  }

  const { error } = await supabase.from('app_states').upsert({
    user_id: user.id,
    state: body,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' })

  if (error) { const safe = mapSafeError(error, 'state.write'); return NextResponse.json({ error: safe.message }, { status: safe.status }) }
  return NextResponse.json({ ok: true })
}
