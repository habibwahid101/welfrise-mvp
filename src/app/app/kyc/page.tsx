import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import KycForm from './kyc-form'

export const dynamic = 'force-dynamic'

const labels: Record<string, string> = {
  not_submitted: 'Not submitted', pending: 'Pending', approved: 'Approved', rejected: 'Rejected', held: 'Under review',
}

export default async function KycPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const [{ data: profile }, { data: submission }] = await Promise.all([
    supabase.from('profiles').select('full_name,kyc_status').eq('id', user.id).single(),
    supabase.from('kyc_submissions').select('status,submitted_at,review_note,id_document_path,selfie_path,address_document_path').eq('user_id', user.id).maybeSingle(),
  ])
  const status = String(submission?.status || profile?.kyc_status || 'not_submitted')
  const canSubmit = status === 'not_submitted' || status === 'rejected'
  const paths = submission ? [submission.id_document_path, submission.selfie_path, submission.address_document_path].filter(Boolean) : []
  const signed = await Promise.all(paths.map(async (path) => {
    const { data } = await supabase.storage.from('welfrise-private').createSignedUrl(String(path), 300)
    return data?.signedUrl
  }))

  return (
    <main className="portal-page">
      <header className="portal-head">
        <div><p className="eyebrow">Welfrise · Give. Grow. Rise.</p><h1>Profile & KYC</h1><p>{profile?.full_name || user.email}</p></div>
        <nav className="portal-nav"><Link href="/app">Dashboard</Link><Link href="/app/payments">Payments & Wallet</Link></nav>
      </header>
      <div className="portal-stack">
        <section className="portal-panel">
          <div className="panel-title-row"><div><h2>Identity verification</h2><p>Status: <strong>{labels[status] || status.replaceAll('_', ' ')}</strong></p></div></div>
          {submission?.review_note ? <div className="rule-box"><strong>Review note:</strong> {submission.review_note}</div> : null}
          {submission ? <p className="small-muted">Submitted {new Date(submission.submitted_at).toLocaleString()}. Document links expire after five minutes.</p> : null}
          {signed.filter(Boolean).length ? <div className="document-links">{signed.map((url, index) => url ? <a key={url} href={url} target="_blank" rel="noreferrer">View document {index + 1}</a> : null)}</div> : null}
          {!canSubmit ? <div className="notice success" role="status">{status === 'approved' ? 'Your identity verification is approved.' : 'Your submission is being reviewed. You cannot replace documents while review is active.'}</div> : <KycForm canSubmit={canSubmit} />}
        </section>
      </div>
    </main>
  )
}
