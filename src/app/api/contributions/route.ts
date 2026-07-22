import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json({
    error: 'Direct contribution submission is disabled. Create an assigned Binance payment request or a User Wallet authorization request.',
  }, { status: 410 })
}
