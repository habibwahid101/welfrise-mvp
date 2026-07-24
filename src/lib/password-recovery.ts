export const PASSWORD_MIN_LENGTH = 12
export const RECOVERY_SUCCESS_MESSAGE = 'If an account exists for this email, a password-reset link has been sent.'
export const RECOVERY_RATE_MESSAGE = 'Recovery email delivery is temporarily limited. Please wait before trying again.'
export const PRODUCTION_RECOVERY_CALLBACK = 'https://welfrise-mvp.vercel.app/auth/callback?next=/reset-password&flow=recovery'

export const INVALID_RECOVERY_LINK_MESSAGE =
  'This password recovery link is invalid, expired, or has already been used. Request a new link from the sign-in page.'

export const MISSING_RECOVERY_LINK_MESSAGE =
  'No password recovery link was found. Request a new link from the sign-in page.'

export function hasRecoveryLinkParameters(url: string) {
  const parsed = new URL(url)
  const hash = new URLSearchParams(parsed.hash.replace(/^#/, ''))
  const parameterSets = [parsed.searchParams, hash]

  return parameterSets.some((parameters) =>
    parameters.get('type') === 'recovery' ||
    ['code', 'token', 'token_hash', 'access_token', 'refresh_token', 'error', 'error_code', 'error_description']
      .some((name) => parameters.has(name)),
  )
}

export function validateRecoveryPasswords(password: string, confirmation: string) {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`
  }
  if (password !== confirmation) return 'Passwords do not match.'
  return ''
}

type AuthFailure = { code?: unknown; status?: unknown; message?: unknown }

export function classifyRecoveryError(error: unknown) {
  const failure = (error && typeof error === 'object' ? error : {}) as AuthFailure
  const code = typeof failure.code === 'string' ? failure.code : 'unknown'
  const status = typeof failure.status === 'number' ? failure.status : 500
  const message = typeof failure.message === 'string' ? failure.message : ''
  if (/^(?:user|email)_not_found$/i.test(code)) {
    return { kind: 'neutral' as const, code, status }
  }
  if (status === 429 || /rate|too many|over_email_send/i.test(`${code} ${message}`)) {
    return { kind: 'rate' as const, code, status: 429 }
  }
  if (/smtp|email|provider|send|hook/i.test(code) || status >= 500) {
    return { kind: 'delivery' as const, code, status: status >= 400 ? status : 503 }
  }
  return { kind: 'unexpected' as const, code, status: status >= 400 ? status : 500 }
}

export function safeRecoveryNext(value: string | null, flow: string | null) {
  if (flow === 'recovery') return '/reset-password'
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/app'
  return value
}

export function isValidEmailInput(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254
}

export async function recoveryEmailHash(email: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email.trim().toLowerCase()))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 16)
}
