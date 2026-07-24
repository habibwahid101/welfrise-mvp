'use client'

import Link from 'next/link'
import { useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { PasswordInput } from '@/components/password-input'

const RECOVERY_REQUEST_MESSAGE = 'If an account exists for this email, a password-reset link has been sent.'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [recoveryOpen, setRecoveryOpen] = useState(false)
  const [recoveryEmail, setRecoveryEmail] = useState('')
  const [recoveryMessage, setRecoveryMessage] = useState('')
  const [recoveryBusy, setRecoveryBusy] = useState(false)
  const recoveryBusyRef = useRef(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || 'Unable to sign in.')
      window.location.href = '/app'
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to sign in.')
    } finally {
      setBusy(false)
    }
  }

  async function requestRecovery(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (recoveryBusyRef.current) return
    recoveryBusyRef.current = true
    setRecoveryBusy(true)
    setRecoveryMessage('')
    try {
      const supabase = createClient()
      await supabase.auth.resetPasswordForEmail(recoveryEmail.trim().toLowerCase(), {
        redirectTo: `${window.location.origin}/reset-password`,
      })
    } catch {
      // The response remains deliberately neutral to prevent account enumeration.
    } finally {
      setRecoveryMessage(RECOVERY_REQUEST_MESSAGE)
      setRecoveryBusy(false)
      recoveryBusyRef.current = false
    }
  }

  return (
    <main className="shell">
      <section className="auth-card">
        <div className="brand">
          <div className="brand-mark">🌱</div>
          <h1>Welfrise</h1>
          <p>Give. Grow. Rise. · Closed-pilot access</p>
        </div>
        <form className="form" onSubmit={submit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <PasswordInput id="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
          </div>
          <div className="forgot-password-row"><button className="link-button" type="button" aria-expanded={recoveryOpen} onClick={() => { setRecoveryOpen((current) => !current); setRecoveryEmail((current) => current || email); setRecoveryMessage('') }}>Forgot password?</button></div>
          {message ? <div className="notice error" role="alert" aria-live="polite">{message}</div> : null}
          <button className="primary-button" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <div className="secondary-link">No account? <Link href="/register">Create one</Link></div>
        </form>
        {recoveryOpen ? <form className="form recovery-request" onSubmit={requestRecovery}>
          <div><h2>Reset your password</h2><p>Enter your email and we’ll send recovery instructions if the account is eligible.</p></div>
          <div className="field">
            <label htmlFor="recovery-email">Email</label>
            <input id="recovery-email" type="email" value={recoveryEmail} onChange={(event) => setRecoveryEmail(event.target.value)} required autoComplete="email" disabled={recoveryBusy} />
          </div>
          {recoveryMessage ? <div className="notice success" role="status" aria-live="polite">{recoveryMessage}</div> : null}
          <button className="secondary-button recovery-button" disabled={recoveryBusy}>{recoveryBusy ? 'Sending…' : 'Send recovery link'}</button>
        </form> : null}
      </section>
    </main>
  )
}
