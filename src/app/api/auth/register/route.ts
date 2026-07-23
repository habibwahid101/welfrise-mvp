import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { mapSafeError } from '@/lib/safe-errors'
import { enforceRateLimit, requestActorKey } from '@/lib/rate-limit'

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const fullName = String(body?.fullName || '').trim()
  const email = String(body?.email || '').trim().toLowerCase()
  const phone = String(body?.phone || '').trim()
  const password = String(body?.password || '')
  const referral = String(body?.referral || '').trim()
  const inviteCode = String(body?.inviteCode || '').trim()

  if (fullName.length < 2 || !email || phone.length < 5 || password.length < 8 || !inviteCode) {
    return NextResponse.json({ error: 'Complete every required field with valid information.' }, { status: 400 })
  }

  try {
    const supabase = await createClient()
    await enforceRateLimit(supabase, 'register', await requestActorKey(request, email))
    const origin = new URL(request.url).origin
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${origin}/auth/callback`,
        data: {
          full_name: fullName,
          phone,
          referral_code_used: referral || null,
          pilot_invite_code: inviteCode,
        },
      },
    })
    if (error) {
      console.warn('Rejected closed-pilot registration', { code: error.code })
      return NextResponse.json({ error: 'Registration could not be completed. Check your invitation or contact the pilot administrator.' }, { status: 400 })
    }
    return NextResponse.json({ ok: true, sessionCreated: Boolean(data.session) })
  } catch (error) {
    const safe = mapSafeError(error, 'auth.register')
    return NextResponse.json({ error: safe.status === 500 ? safe.message : 'Registration could not be completed. Check your invitation or contact the pilot administrator.' }, { status: safe.status })
  }
}
