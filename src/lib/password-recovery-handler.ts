import {
  classifyRecoveryError, isValidEmailInput, PRODUCTION_RECOVERY_CALLBACK,
  recoveryEmailHash, RECOVERY_RATE_MESSAGE, RECOVERY_SUCCESS_MESSAGE,
} from './password-recovery'

type RecoveryClient = {
  auth: { resetPasswordForEmail(email: string, options: { redirectTo: string }): Promise<{ error: unknown }> }
}

type Dependencies = {
  createClient: () => Promise<RecoveryClient>
  rateLimit: (client: RecoveryClient, request: Request, email: string) => Promise<void>
  log?: (message: string, context: Record<string, unknown>) => void
  recoveryCallback?: string
}

function json(body: Record<string, unknown>, status: number) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' } })
}

export function createPasswordRecoveryHandler(dependencies: Dependencies) {
  return async function handlePasswordRecovery(request: Request) {
    const correlationId = crypto.randomUUID()
    const requestUrl = new URL(request.url)
    const origin = request.headers.get('origin')
    if (origin && origin !== requestUrl.origin) return json({ error: 'Unable to process this request.' }, 403)

    const body = await request.json().catch(() => null)
    const email = String(body?.email || '').trim().toLowerCase()
    if (!isValidEmailInput(email)) return json({ error: 'Enter a valid email address.' }, 400)

    const redirectTo = dependencies.recoveryCallback || PRODUCTION_RECOVERY_CALLBACK
    const emailHash = await recoveryEmailHash(email)
    try {
      const client = await dependencies.createClient()
      await dependencies.rateLimit(client, request, email)
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo })
      if (!error) return json({ ok: true, message: RECOVERY_SUCCESS_MESSAGE }, 200)

      const failure = classifyRecoveryError(error)
      if (failure.kind === 'neutral') return json({ ok: true, message: RECOVERY_SUCCESS_MESSAGE }, 200)
      dependencies.log?.('Password recovery provider rejected request', {
        correlationId, emailHash, code: failure.code, status: failure.status,
        stage: 'resetPasswordForEmail', redirectPath: '/auth/callback?next=/reset-password&flow=recovery',
      })
      if (failure.kind === 'rate') return json({ error: RECOVERY_RATE_MESSAGE, correlationId }, 429)
      return json({ error: `We could not process the recovery request right now. Reference: ${correlationId}`, correlationId }, 503)
    } catch (error) {
      const failure = classifyRecoveryError(error)
      dependencies.log?.('Password recovery request failed', {
        correlationId, emailHash, code: failure.code, status: failure.status,
        stage: 'application', redirectPath: '/auth/callback?next=/reset-password&flow=recovery',
      })
      if (failure.kind === 'rate') return json({ error: RECOVERY_RATE_MESSAGE, correlationId }, 429)
      return json({ error: `We could not process the recovery request right now. Reference: ${correlationId}`, correlationId }, 503)
    }
  }
}
