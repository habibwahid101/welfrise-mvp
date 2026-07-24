import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { safeRecoveryNext } from '@/lib/password-recovery'

const RECOVERY_COOKIE = 'welfrise_recovery_verified'

function invalidRecovery(requestUrl: URL, correlationId: string) {
  const target = new URL('/reset-password', requestUrl.origin)
  target.searchParams.set('error', 'invalid_recovery')
  target.searchParams.set('reference', correlationId)
  const response = NextResponse.redirect(target)
  response.cookies.delete(RECOVERY_COOKIE)
  return response
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const flow = requestUrl.searchParams.get('flow')
  const next = safeRecoveryNext(requestUrl.searchParams.get('next'), flow)
  const correlationId = crypto.randomUUID()

  if (!code) return flow === 'recovery'
    ? invalidRecovery(requestUrl, correlationId)
    : NextResponse.redirect(new URL('/login', requestUrl.origin))

  try {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      console.warn('Supabase PKCE callback exchange rejected', {
        correlationId, code: error.code || 'unknown', status: error.status || 500,
        stage: 'exchangeCodeForSession', flow: flow === 'recovery' ? 'recovery' : 'authentication',
      })
      return flow === 'recovery'
        ? invalidRecovery(requestUrl, correlationId)
        : NextResponse.redirect(new URL('/login?auth_error=callback', requestUrl.origin))
    }

    const target = new URL(next, requestUrl.origin)
    if (flow === 'recovery') {
      target.searchParams.set('flow', 'recovery')
      target.searchParams.set('verified', '1')
    }
    const response = NextResponse.redirect(target)
    if (flow === 'recovery') {
      response.cookies.set(RECOVERY_COOKIE, crypto.randomUUID(), {
        httpOnly: true, secure: requestUrl.protocol === 'https:', sameSite: 'lax', path: '/', maxAge: 600,
      })
    }
    return response
  } catch {
    console.warn('Supabase PKCE callback exchange unavailable', { correlationId, stage: 'exchangeCodeForSession', flow: flow === 'recovery' ? 'recovery' : 'authentication' })
    return flow === 'recovery'
      ? invalidRecovery(requestUrl, correlationId)
      : NextResponse.redirect(new URL('/login?auth_error=callback', requestUrl.origin))
  }
}
