import { NextResponse } from 'next/server'

export function GET() {
  return NextResponse.json({
    configured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
    pilotMode: true,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
  })
}
