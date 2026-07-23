import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { mapSafeError } from '@/lib/safe-errors'
import { enforceRateLimit, requestActorKey } from '@/lib/rate-limit'

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const email = String(body?.email || '').trim().toLowerCase()
  const password = String(body?.password || '')
  if (!email || !password) return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 })

  try {
    const supabase = await createClient()
    await enforceRateLimit(supabase, 'login', await requestActorKey(request, email))
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      console.warn('Rejected login attempt', { code: error.code })
      return NextResponse.json({ error: 'Email or password is incorrect.' }, { status: 400 })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    const safe = mapSafeError(error, 'auth.login')
    return NextResponse.json({ error: safe.message }, { status: safe.status })
  }
}
