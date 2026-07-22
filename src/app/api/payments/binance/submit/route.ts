import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120)
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const form = await request.formData()
  const requestId = String(form.get('requestId') || '').trim()
  const txHash = String(form.get('txHash') || '').trim()
  const proof = form.get('proof')

  if (!/^[0-9a-fA-F-]{36}$/.test(requestId)) {
    return NextResponse.json({ error: 'Invalid payment request' }, { status: 400 })
  }
  if (txHash.length < 10 || txHash.length > 180) {
    return NextResponse.json({ error: 'Invalid transaction hash' }, { status: 400 })
  }
  if (!(proof instanceof File) || proof.size < 1 || proof.size > 5_000_000) {
    return NextResponse.json({ error: 'Payment proof up to 5 MB is required' }, { status: 400 })
  }
  if (!ALLOWED_TYPES.has(proof.type)) {
    return NextResponse.json({ error: 'Proof must be JPG, PNG, WebP, or PDF' }, { status: 400 })
  }

  const proofPath = `${user.id}/payments/${requestId}-${safeName(proof.name || 'proof')}`
  const { error: uploadError } = await supabase.storage
    .from('welfrise-private')
    .upload(proofPath, proof, { upsert: false, contentType: proof.type })
  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 })

  const { data, error } = await supabase.rpc('submit_binance_payment', {
    p_request_id: requestId,
    p_tx_hash: txHash,
    p_proof_path: proofPath,
  })

  if (error) {
    await supabase.storage.from('welfrise-private').remove([proofPath])
    const status = /duplicate|unique|already/i.test(error.message) ? 409 : 400
    return NextResponse.json({ error: error.message }, { status })
  }
  return NextResponse.json({ ok: true, status: data })
}
