import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { validatePrivateDocument } from '@/lib/file-validation'
import { mapSafeError } from '@/lib/safe-errors'
import { enforceRateLimit, requestActorKey } from '@/lib/rate-limit'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'You must sign in to continue.' }, { status: 401 })

  let proofPath = ''
  let uploadedNew = false
  try {
    await enforceRateLimit(supabase, 'proof_upload', await requestActorKey(request, user.id))
    const form = await request.formData()
    const requestId = String(form.get('requestId') || '').trim()
    const txHash = String(form.get('txHash') || '').trim()
    if (!/^[0-9a-fA-F-]{36}$/.test(requestId)) throw new Error('Invalid payment proof request')
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error('Invalid transaction hash')
    const proof = await validatePrivateDocument(form.get('proof'), 'Payment proof')
    const idempotencyKey = request.headers.get('idempotency-key') || crypto.randomUUID()
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(idempotencyKey)) throw new Error('Invalid payment proof request')
    proofPath = `${user.id}/payments/${requestId}/proof-${idempotencyKey}`
    const { error: uploadError } = await supabase.storage.from('welfrise-private').upload(proofPath, proof.file, {
      upsert: false, contentType: proof.file.type, cacheControl: '0',
    })
    if (uploadError && !/already exists|duplicate|resource exists/i.test(uploadError.message)) throw uploadError
    uploadedNew = !uploadError
    const { data, error } = await supabase.rpc('submit_binance_payment_v2', {
      p_request_id: requestId, p_tx_hash: txHash, p_proof_path: proofPath,
      p_idempotency_key: idempotencyKey,
    })
    if (error) throw error
    if (data === 'expired') {
      if (proofPath && uploadedNew) await supabase.storage.from('welfrise-private').remove([proofPath])
      return NextResponse.json(
        { error: 'This payment request has expired. Create a new request and try again.' },
        { status: 409 },
      )
    }
    return NextResponse.json({ ok: true, status: data })
  } catch (error) {
    if (proofPath && uploadedNew) await supabase.storage.from('welfrise-private').remove([proofPath])
    const safe = mapSafeError(error, 'payments.binance.submit')
    return NextResponse.json({ error: safe.message }, { status: safe.status })
  }
}
