'use client'

import Link from 'next/link'
import { useRef, useState } from 'react'
import { PasswordInput } from '@/components/password-input'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [recoveryOpen, setRecoveryOpen] = useState(false)
  const [recoveryEmail, setRecoveryEmail] = useState('')
  const [recoveryMessage, setRecoveryMessage] = useState('')
  const [recoveryError, setRecoveryError] = useState(false)
  const [recoveryBusy, setRecoveryBusy] = useState(false)
  const recoveryBusyRef = useRef(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    setRecoveryMessage('')
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || 'Unable to sign in.')
      window.location.href = '/app'
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to sign in.')
    } finally { setBusy(false) }
  }

  function openRecovery() {
    setRecoveryEmail(email)
    setRecoveryMessage('')
    setRecoveryError(false)
    setMessage('')
    setRecoveryOpen(true)
  }

  async function requestRecovery(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (recoveryBusyRef.current) return
    recoveryBusyRef.current = true
    setRecoveryBusy(true)
    setRecoveryMessage('')
    setRecoveryError(false)
    try {
      const response = await fetch('/api/auth/password-recovery/request', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: recoveryEmail }),
      })
      const result = await response.json().catch(() => ({}))
      setRecoveryError(!response.ok)
      setRecoveryMessage(result.message || result.error || 'We could not process the recovery request right now.')
    } catch {
      setRecoveryError(true)
      setRecoveryMessage('We could not process the recovery request right now. Please try again later.')
    } finally {
      setRecoveryBusy(false)
      recoveryBusyRef.current = false
    }
  }

  return <main className="shell"><section className="auth-card">
    <div className="brand"><div className="brand-mark">🌱</div><h1>Welfrise</h1><p>Give. Grow. Rise. · Closed-pilot access</p></div>
    {!recoveryOpen ? <form className="form" onSubmit={submit}>
      <div className="field"><label htmlFor="email">Email</label><input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" /></div>
      <div className="field"><label htmlFor="password">Password</label><PasswordInput id="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" /></div>
      <div className="forgot-password-row"><button className="link-button" type="button" onClick={openRecovery}>Forgot password?</button></div>
      {message ? <div className="notice error" role="alert" aria-live="polite">{message}</div> : null}
      <button className="primary-button" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      <div className="secondary-link">No account? <Link href="/register">Create one</Link></div>
    </form> : <form className="form recovery-request" onSubmit={requestRecovery}>
      <div><h2>Reset your password</h2><p>Enter your email and we’ll send recovery instructions if the account is eligible.</p></div>
      <div className="field"><label htmlFor="recovery-email">Email</label><input id="recovery-email" type="email" value={recoveryEmail} onChange={(event) => setRecoveryEmail(event.target.value)} required autoComplete="email" disabled={recoveryBusy} /></div>
      {recoveryMessage ? <div className={`notice ${recoveryError ? 'error' : 'success'}`} role={recoveryError ? 'alert' : 'status'} aria-live="polite">{recoveryMessage}</div> : null}
      <button className="primary-button recovery-button" disabled={recoveryBusy}>{recoveryBusy ? 'Sending…' : 'Send recovery link'}</button>
      <button className="link-button recovery-back" type="button" disabled={recoveryBusy} onClick={() => { setRecoveryOpen(false); setRecoveryMessage(''); setRecoveryError(false) }}>Return to sign in</button>
    </form>}
  </section></main>
}
