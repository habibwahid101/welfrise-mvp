import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { validateRecoveryPasswords } from '@/lib/password-recovery'

export const dynamic = 'force-dynamic'

function response(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store, max-age=0' } })
}

export async function POST(request: Request) {
  const requestUrl = new URL(request.url)
  const origin = request.headers.get('origin')
  if (origin && origin !== requestUrl.origin) return response({ error: 'Unable to process this request.' }, 403)

  const body = await request.json().catch(() => null)
  const password = String(body?.password || '')
  const confirmation = String(body?.confirmation || '')
  const validationError = validateRecoveryPasswords(password, confirmation)
  if (validationError) return response({ error: validationError }, 400)

  const cookieStore = await cookies()
  if (!cookieStore.get('welfrise_recovery_verified')?.value) return response({ error: 'This password recovery link is invalid or expired.' }, 401)

  try {
    const supabase = await createClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) return response({ error: 'This password recovery link is invalid or expired.' }, 401)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      const correlationId = crypto.randomUUID()
      console.warn('Password recovery update rejected', { correlationId, code: error.code || 'unknown', status: error.status || 500, stage: 'updateUser' })
      return response({ error: `We could not update the password right now. Reference: ${correlationId}` }, 503)
    }
    await supabase.auth.signOut({ scope: 'local' })
    cookieStore.delete('welfrise_recovery_verified')
    return response({ ok: true })
  } catch {
    const correlationId = crypto.randomUUID()
    console.warn('Password recovery update unavailable', { correlationId, stage: 'updateUser' })
    return response({ error: `We could not update the password right now. Reference: ${correlationId}` }, 503)
  }
}
