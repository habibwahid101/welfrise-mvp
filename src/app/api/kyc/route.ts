import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { assertKycSubmissionSize, validatePrivateDocument } from '@/lib/file-validation'
import { mapSafeError } from '@/lib/safe-errors'
import { enforceRateLimit, requestActorKey } from '@/lib/rate-limit'

const BUCKET = 'welfrise-private'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'You must sign in to continue.' }, { status: 401 })

  const uploaded: string[] = []
  try {
    await enforceRateLimit(supabase, 'kyc_upload', await requestActorKey(request, user.id))
    const { data: existing, error: existingError } = await supabase
      .from('kyc_submissions')
      .select('id,status,id_document_path,selfie_path,address_document_path')
      .eq('user_id', user.id)
      .maybeSingle()
    if (existingError) throw existingError
    if (existing && existing.status !== 'rejected') {
      return NextResponse.json({ error: 'A KYC submission is already under review or approved.' }, { status: 409 })
    }

    const form = await request.formData()
    const idDocument = await validatePrivateDocument(form.get('idDocument'), 'ID document')
    const selfie = await validatePrivateDocument(form.get('selfie'), 'Selfie')
    const addressDocument = await validatePrivateDocument(form.get('addressDocument'), 'Address document')
    assertKycSubmissionSize([idDocument.file, selfie.file, addressDocument.file])
    const submissionId = existing?.id || crypto.randomUUID()
    const uploadId = crypto.randomUUID()

    const documents = [
      ['id', idDocument] as const,
      ['selfie', selfie] as const,
      ['address', addressDocument] as const,
    ]
    for (const [label, document] of documents) {
      const path = `${user.id}/kyc/${submissionId}/${uploadId}-${label}.${document.extension}`
      const { error } = await supabase.storage.from(BUCKET).upload(path, document.file, {
        upsert: false,
        contentType: document.file.type,
        cacheControl: '0',
      })
      if (error) throw error
      uploaded.push(path)
    }

    const { data, error } = await supabase.rpc('submit_kyc_metadata_v2', {
      p_submission_id: submissionId,
      p_id_document_path: uploaded[0],
      p_selfie_path: uploaded[1],
      p_address_document_path: uploaded[2],
    })
    if (error) throw error

    const oldPaths = existing
      ? [existing.id_document_path, existing.selfie_path, existing.address_document_path].filter(Boolean)
      : []
    if (oldPaths.length) await supabase.storage.from(BUCKET).remove(oldPaths)
    return NextResponse.json({ ok: true, kyc: { id: submissionId, status: data } })
  } catch (error) {
    if (uploaded.length) await supabase.storage.from(BUCKET).remove(uploaded)
    const safe = mapSafeError(error, 'kyc.submit')
    return NextResponse.json({ error: safe.message }, { status: safe.status === 500 ? 400 : safe.status })
  }
}
