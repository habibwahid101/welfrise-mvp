import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { enforceRateLimit, requestActorKey } from '@/lib/rate-limit'
import { authFailureDetails, registrationLogContext, RESEND_NEUTRAL_MESSAGE } from '@/lib/registration-errors'

export async function POST(request: Request) {
  const correlationId = crypto.randomUUID()
  const body = await request.json().catch(() => null)
  const email = String(body?.email || '').trim().toLowerCase()
  if (!email) return NextResponse.json({ message: RESEND_NEUTRAL_MESSAGE, correlationId })

  try {
    const supabase = await createClient()
    await enforceRateLimit(supabase, 'register', await requestActorKey(request, `resend:${email}`))
    const { error } = await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: `${new URL(request.url).origin}/auth/callback` } })
    if (error) {
      const failure = authFailureDetails(error)
      console.warn('Closed-pilot confirmation resend rejected', { correlationId, ...failure, ...(await registrationLogContext(email)), stage: 'resend' })
    }
  } catch (error) {
    const failure = authFailureDetails(error)
    console.warn('Closed-pilot confirmation resend unavailable', { correlationId, ...failure, ...(await registrationLogContext(email)), stage: 'resend' })
  }
  return NextResponse.json({ message: RESEND_NEUTRAL_MESSAGE, correlationId })
}
