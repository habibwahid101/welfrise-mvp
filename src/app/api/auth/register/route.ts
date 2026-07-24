import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { enforceRateLimit, requestActorKey } from '@/lib/rate-limit'
import {
  authFailureDetails, registrationLogContext, REGISTRATION_EMAIL_MESSAGE,
  REGISTRATION_INVITE_MESSAGE, REGISTRATION_NEUTRAL_MESSAGE, REGISTRATION_RATE_MESSAGE,
} from '@/lib/registration-errors'

export async function POST(request: Request) {
  const correlationId = crypto.randomUUID()
  const body = await request.json().catch(() => null)
  const fullName = String(body?.fullName || '').trim()
  const email = String(body?.email || '').trim().toLowerCase()
  const phone = String(body?.phone || '').trim()
  const password = String(body?.password || '')
  const referral = String(body?.referral || '').trim()
  const inviteCode = String(body?.inviteCode || '').trim()

  if (fullName.length < 2 || !email || phone.length < 5 || password.length < 8 || !inviteCode) {
    return NextResponse.json({ error: 'Complete every required field with valid information.', correlationId }, { status: 400 })
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
      const failure = authFailureDetails(error)
      console.warn('Rejected closed-pilot registration', {
        correlationId, code: failure.code, status: failure.status, kind: failure.kind,
        ...(await registrationLogContext(email)), stage: 'auth.signUp', hasReferral: Boolean(referral),
      })
      if (failure.kind === 'duplicate') return NextResponse.json({ ok: true, sessionCreated: false, message: REGISTRATION_NEUTRAL_MESSAGE, correlationId }, { status: 202 })
      if (failure.kind === 'rate') return NextResponse.json({ error: REGISTRATION_RATE_MESSAGE, correlationId, recoverable: true }, { status: 429 })
      if (failure.kind === 'email') return NextResponse.json({ error: REGISTRATION_EMAIL_MESSAGE, correlationId, recoverable: true }, { status: 503 })
      return NextResponse.json({ error: REGISTRATION_INVITE_MESSAGE, correlationId }, { status: 400 })
    }
    return NextResponse.json({ ok: true, sessionCreated: Boolean(data.session), message: REGISTRATION_NEUTRAL_MESSAGE })
  } catch (error) {
    const failure = authFailureDetails(error)
    console.warn('Closed-pilot registration unavailable', {
      correlationId, code: failure.code, status: failure.status, kind: failure.kind,
      ...(await registrationLogContext(email)), stage: 'registration', hasReferral: Boolean(referral),
    })
    const status = failure.kind === 'rate' ? 429 : 503
    const message = failure.kind === 'rate' ? REGISTRATION_RATE_MESSAGE : REGISTRATION_EMAIL_MESSAGE
    return NextResponse.json({ error: message, correlationId, recoverable: true }, { status })
  }
}
