import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120)
}

async function upload(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  submissionId: string,
  label: string,
  value: FormDataEntryValue | null,
) {
  if (!(value instanceof File) || value.size < 1 || value.size > 5_000_000) {
    throw new Error(`${label} file is required and must be no larger than 5 MB`)
  }
  const path = `${userId}/kyc/${submissionId}-${label}-${safeName(value.name || 'document.bin')}`
  const { error } = await supabase.storage.from('welfrise-private').upload(path, value, {
    upsert: false,
    contentType: value.type || undefined,
  })
  if (error) throw error
  return path
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const form = await request.formData()
  const submissionId = crypto.randomUUID()
  const uploaded: string[] = []

  try {
    const idPath = await upload(supabase, user.id, submissionId, 'id', form.get('idDocument')); uploaded.push(idPath)
    const selfiePath = await upload(supabase, user.id, submissionId, 'selfie', form.get('selfie')); uploaded.push(selfiePath)
    const addressPath = await upload(supabase, user.id, submissionId, 'address', form.get('addressDocument')); uploaded.push(addressPath)

    const { data, error } = await supabase.from('kyc_submissions').upsert({
      id: submissionId,
      user_id: user.id,
      id_document_path: idPath,
      selfie_path: selfiePath,
      address_document_path: addressPath,
      status: 'pending',
      submitted_at: new Date().toISOString(),
      reviewed_at: null,
      reviewed_by: null,
      review_note: null,
    }, { onConflict: 'user_id' }).select('id, status, submitted_at').single()

    if (error) throw error
    return NextResponse.json({ ok: true, kyc: data })
  } catch (error) {
    if (uploaded.length) await supabase.storage.from('welfrise-private').remove(uploaded)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'KYC upload failed' }, { status: 500 })
  }
}
