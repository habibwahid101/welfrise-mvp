import { NextResponse } from 'next/server'

export function GET() {
  const supabaseConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  )
  return NextResponse.json({
    ok: true,
    service: 'welfrise-mvp',
    supabaseConfigured,
    pilotMode: true,
    timestamp: new Date().toISOString(),
  })
}
