type AuthFailure = { code?: string; status?: number }

export const REGISTRATION_NEUTRAL_MESSAGE = 'If this email is eligible, check your inbox for account confirmation instructions.'
export const REGISTRATION_INVITE_MESSAGE = 'Registration could not be completed. Check that your invitation is valid, unused, and not expired.'
export const REGISTRATION_RATE_MESSAGE = 'Registration is temporarily limited. Please wait and try again.'
export const REGISTRATION_EMAIL_MESSAGE = 'Email delivery is temporarily unavailable. Please try again later.'
export const RESEND_NEUTRAL_MESSAGE = 'If an eligible unconfirmed account exists for this email, a confirmation link has been sent.'

export function authFailureDetails(error: unknown) {
  const failure = (error && typeof error === 'object' ? error : {}) as AuthFailure
  const code = typeof failure.code === 'string' ? failure.code : 'unknown'
  const status = typeof failure.status === 'number' ? failure.status : 500
  if (status === 429 || /rate|over_request_rate_limit/i.test(code)) return { kind: 'rate' as const, code, status }
  if (/already|exists|registered/i.test(code)) return { kind: 'duplicate' as const, code, status }
  if (status >= 500 && /email|smtp|send|hook/i.test(code)) return { kind: 'email' as const, code, status }
  return { kind: 'invitation' as const, code, status }
}

export async function registrationLogContext(email: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email.trim().toLowerCase()))
  const emailHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 16)
  return { emailHash }
}
