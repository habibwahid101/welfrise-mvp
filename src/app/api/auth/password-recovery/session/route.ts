import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const cookieStore = await cookies()
  const marker = cookieStore.get('welfrise_recovery_verified')?.value
  if (!marker) return Response.json({ valid: false }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
  try {
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) {
      cookieStore.delete('welfrise_recovery_verified')
      return Response.json({ valid: false }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
    }
    return Response.json({ valid: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    cookieStore.delete('welfrise_recovery_verified')
    return Response.json({ valid: false }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
  }
}
