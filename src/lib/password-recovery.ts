export const PASSWORD_MIN_LENGTH = 12

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
