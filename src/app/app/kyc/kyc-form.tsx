'use client'

import { useState } from 'react'

export default function KycForm({ canSubmit }: { canSubmit: boolean }) {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !canSubmit) return
    setBusy(true)
    setNotice(null)
    const form = new FormData(event.currentTarget)
    try {
      const response = await fetch('/api/kyc', { method: 'POST', body: form })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || 'Unable to submit KYC documents.')
      setNotice({ kind: 'success', message: 'Your KYC documents were submitted for review.' })
      event.currentTarget.reset()
      window.setTimeout(() => window.location.reload(), 800)
    } catch (error) {
      setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'Unable to submit KYC documents.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="form kyc-form" onSubmit={submit}>
      <p className="small-muted">JPG, PNG, WebP, or PDF only. Maximum 5 MB per document. Files are stored privately.</p>
      <div className="field"><label htmlFor="idDocument">Government-issued ID document</label><input id="idDocument" name="idDocument" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required disabled={!canSubmit || busy} /></div>
      <div className="field"><label htmlFor="selfie">Selfie</label><input id="selfie" name="selfie" type="file" accept="image/jpeg,image/png,image/webp" required disabled={!canSubmit || busy} /></div>
      <div className="field"><label htmlFor="addressDocument">Proof of address</label><input id="addressDocument" name="addressDocument" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required disabled={!canSubmit || busy} /></div>
      {notice ? <div className={`notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'} aria-live="polite">{notice.message}</div> : null}
      <button className="primary-button" disabled={!canSubmit || busy}>{busy ? 'Uploading…' : 'Submit KYC documents'}</button>
    </form>
  )
}
