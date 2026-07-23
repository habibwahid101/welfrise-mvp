export type SafeError = {
  message: string
  status: number
  correlationId?: string
}

const knownErrors: Array<[RegExp, string, number]> = [
  [/unauthorized|not authenticated/i, 'You must sign in to continue.', 401],
  [/admin mfa|required.*aal2|aal2.*required/i, 'Complete MFA verification to continue.', 403],
  [/admin access|required.*admin/i, 'You do not have permission to perform this action.', 403],
  [/invalid package/i, 'Select a valid payment package.', 400],
  [/invalid level|not unlocked/i, 'Select an eligible unlocked level.', 400],
  [/invalid bep20|invalid wallet address/i, 'Enter a valid BEP20 wallet address.', 400],
  [/duplicate.*wallet|receiving_wallet.*unique|receiving_wallets_network_wallet/i, 'That receiving wallet is already registered.', 409],
  [/insufficient.*balance/i, 'The available wallet balance is insufficient.', 400],
  [/approved kyc|kyc.*required|kyc not approved/i, 'Complete and receive approval for KYC before continuing.', 400],
  [/ten active waiting|slot limit/i, 'This request exceeds the 10 active waiting-slot limit.', 400],
  [/expired/i, 'This request has expired. Create a new request.', 409],
  [/already processed|no longer pending|cannot be submitted|not reviewable/i, 'This request has already been processed.', 409],
  [/temporarily unavailable|receiving wallet.*unavailable/i, 'Binance payment is temporarily unavailable. Please try again later or use Pay by User Wallet.', 503],
  [/duplicate.*transaction|transaction.*unique|tx_hash.*unique/i, 'That transaction hash has already been used.', 409],
  [/invalid transaction|invalid payment proof|proof.*required|proof must/i, 'Provide a valid transaction hash and payment proof.', 400],
  [/file is required|document is required|selfie is required|no larger than 5 mb|must be jpg|content does not match/i, 'Use a supported JPG, PNG, WebP, or PDF file no larger than 5 MB.', 400],
  [/kyc submission is already|already under review/i, 'A KYC submission is already under review or approved.', 409],
  [/invalid status|invalid decision/i, 'Select a valid review decision.', 400],
  [/invalid adjustment|audit reason/i, 'Enter a valid adjustment and a clear audit reason.', 400],
  [/verification checklist|confirmation evidence|token contract configuration|verified network|verified recipient/i, 'Complete the required independent on-chain verification checks before approval.', 400],
  [/rate limit|too many requests/i, 'Too many requests. Please wait and try again.', 429],
  [/pilot invitation|registration is closed/i, 'Registration is invitation-only for this closed pilot.', 403],
]

function rawMessage(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message)
  return ''
}

export function mapSafeError(error: unknown, context: string): SafeError {
  const raw = rawMessage(error)
  for (const [pattern, message, status] of knownErrors) {
    if (pattern.test(raw)) return { message, status }
  }

  const correlationId = crypto.randomUUID()
  console.error(`[${correlationId}] ${context}`, error)
  return {
    message: `Something went wrong. Please try again. Reference: ${correlationId}`,
    status: 500,
    correlationId,
  }
}

export function errorMessage(error: unknown, context: string) {
  return mapSafeError(error, context).message
}
