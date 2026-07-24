'use client'

import Link from 'next/link'
import { useRef, useState } from 'react'
import { PasswordInput } from '@/components/password-input'

export default function RegisterPage() {
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', referral: '', inviteCode: '' })
  const [message, setMessage] = useState('')
  const [success, setSuccess] = useState(false)
  const [busy, setBusy] = useState(false)
  const [recoverable, setRecoverable] = useState(false)
  const [correlationId, setCorrelationId] = useState('')
  const submitBusyRef = useRef(false)
  const [resendBusy, setResendBusy] = useState(false)

  function update(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitBusyRef.current) return
    submitBusyRef.current = true
    setBusy(true)
    setMessage('')
    setSuccess(false)
    setRecoverable(false)
    setCorrelationId('')
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fullName: form.name,
          email: form.email,
          phone: form.phone,
          password: form.password,
          referral: form.referral,
          inviteCode: form.inviteCode,
        }),
      })
      const result = await response.json().catch(() => ({}))
      update('password', '')
      setCorrelationId(String(result.correlationId || ''))
      setRecoverable(Boolean(result.recoverable) || response.status === 202)
      if (!response.ok) throw new Error(result.error || 'Unable to create the account.')
      if (result.sessionCreated) {
        window.location.href = '/app'
        return
      }
      setSuccess(true)
      setMessage(result.message || 'If this email is eligible, check your inbox for account confirmation instructions.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to create the account.')
    } finally {
      setBusy(false)
      submitBusyRef.current = false
    }
  }

  async function resendConfirmation() {
    if (resendBusy || !form.email) return
    setResendBusy(true)
    try {
      const response = await fetch('/api/auth/resend-confirmation', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: form.email }) })
      const result = await response.json().catch(() => ({}))
      setSuccess(true)
      setMessage(result.message || 'If an eligible unconfirmed account exists for this email, a confirmation link has been sent.')
      setCorrelationId(String(result.correlationId || ''))
    } finally { setResendBusy(false) }
  }

  return (
    <main className="shell">
      <section className="auth-card">
        <div className="brand">
          <div className="brand-mark">🌱</div>
          <h1>Create account</h1>
          <p>Give. Grow. Rise. · Invitation-only closed pilot</p>
        </div>
        <form className="form" onSubmit={submit}>
          <div className="field"><label htmlFor="name">Full name</label><input id="name" value={form.name} onChange={(e) => update('name', e.target.value)} required /></div>
          <div className="field"><label htmlFor="email">Email</label><input id="email" type="email" value={form.email} onChange={(e) => update('email', e.target.value)} required /></div>
          <div className="field"><label htmlFor="phone">Phone</label><input id="phone" value={form.phone} onChange={(e) => update('phone', e.target.value)} required /></div>
          <div className="field"><label htmlFor="password">Password</label><PasswordInput id="password" minLength={8} value={form.password} onChange={(e) => update('password', e.target.value)} required autoComplete="new-password" /></div>
          <div className="field"><label htmlFor="referral">Referral code (optional)</label><input id="referral" value={form.referral} onChange={(e) => update('referral', e.target.value)} /></div>
          <div className="field"><label htmlFor="inviteCode">Pilot invitation code</label><input id="inviteCode" value={form.inviteCode} onChange={(e) => update('inviteCode', e.target.value)} required autoComplete="one-time-code" /></div>
          {message ? <div className={`notice ${success ? 'success' : 'error'}`} role={success ? 'status' : 'alert'} aria-live="polite">{message}</div> : null}
          {correlationId ? <p className="support-reference">Support reference: <code>{correlationId}</code></p> : null}
          {recoverable ? <button className="secondary-button" type="button" disabled={resendBusy || !form.email} onClick={() => void resendConfirmation()}>{resendBusy ? 'Sending…' : 'Resend confirmation'}</button> : null}
          <button className="primary-button" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
          <div className="secondary-link">Already registered? <Link href="/login">Sign in</Link></div>
        </form>
      </section>
    </main>
  )
}
