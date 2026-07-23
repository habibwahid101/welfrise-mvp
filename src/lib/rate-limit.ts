import type { SupabaseClient } from '@supabase/supabase-js'

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function requestActorKey(request: Request, hint = '') {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const ip = forwarded || request.headers.get('x-real-ip') || 'unknown'
  return sha256(`${ip.toLowerCase()}|${hint.trim().toLowerCase()}`)
}

export async function enforceRateLimit(
  supabase: SupabaseClient,
  scope: 'login' | 'register' | 'payment_create' | 'authorization' | 'proof_upload' | 'withdrawal' | 'kyc_upload',
  actorKey: string,
) {
  const { data, error } = await supabase.rpc('welfrise_check_rate_limit', {
    p_scope: scope,
    p_actor_key: actorKey,
  })
  if (error) throw error
  if (data !== true) throw new Error('Rate limit exceeded')
}
