import { createClient } from '@/lib/supabase/server'
import { createPasswordRecoveryHandler } from '@/lib/password-recovery-handler'
import { enforceRateLimit, requestActorKey } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const handle = createPasswordRecoveryHandler({
  createClient,
  rateLimit: async (client, request, email) => {
    await enforceRateLimit(client as Parameters<typeof enforceRateLimit>[0], 'login', await requestActorKey(request, `password-recovery:${email}`))
  },
  log: (message, context) => console.warn(message, context),
})

export async function POST(request: Request) {
  return handle(request)
}
