'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { PasswordInput } from '@/components/password-input'
import { INVALID_RECOVERY_LINK_MESSAGE, MISSING_RECOVERY_LINK_MESSAGE, PASSWORD_MIN_LENGTH, validateRecoveryPasswords } from '@/lib/password-recovery'

type RecoveryState = 'verifying' | 'ready' | 'invalid' | 'success'

function clearRecoveryUrl() {
  window.history.replaceState(null, '', window.location.pathname)
}

export default function ResetPasswordPage() {
  const [recoveryState, setRecoveryState] = useState<RecoveryState>('verifying')
  const [linkError, setLinkError] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [fieldError, setFieldError] = useState('')
  const [busy, setBusy] = useState(false)
  const submitBusyRef = useRef(false)

  useEffect(() => {
    let active = true
    const parameters = new URLSearchParams(window.location.search)
    const verified = parameters.get('flow') === 'recovery' && parameters.get('verified') === '1'
    const callbackError = parameters.get('error') === 'invalid_recovery'
    clearRecoveryUrl()
    if (callbackError || !verified) {
      const timer = window.setTimeout(() => {
        if (!active) return
        setLinkError(callbackError ? INVALID_RECOVERY_LINK_MESSAGE : MISSING_RECOVERY_LINK_MESSAGE)
        setRecoveryState('invalid')
      }, 0)
      return () => { active = false; window.clearTimeout(timer) }
    }
    void fetch('/api/auth/password-recovery/session', { cache: 'no-store' })
      .then(async (response) => ({ ok: response.ok, result: await response.json().catch(() => ({})) }))
      .then(({ ok, result }) => {
        if (!active) return
        if (ok && result.valid === true) { setLinkError(''); setRecoveryState('ready') }
        else { setLinkError(INVALID_RECOVERY_LINK_MESSAGE); setRecoveryState('invalid') }
      })
      .catch(() => { if (active) { setLinkError(INVALID_RECOVERY_LINK_MESSAGE); setRecoveryState('invalid') } })
    return () => { active = false }
  }, [])

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitBusyRef.current || recoveryState !== 'ready') return
    const validationError = validateRecoveryPasswords(password, confirmation)
    if (validationError) { setFieldError(validationError); return }
    submitBusyRef.current = true
    setBusy(true)
    setFieldError('')
    try {
      const response = await fetch('/api/auth/password-recovery/update', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password, confirmation }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) { setFieldError(result.error || INVALID_RECOVERY_LINK_MESSAGE); return }
      setPassword('')
      setConfirmation('')
      setRecoveryState('success')
    } catch { setFieldError('We could not update the password right now. Please try again.') }
    finally { submitBusyRef.current = false; setBusy(false) }
  }

  return <main className="shell"><section className="auth-card recovery-card">
    <div className="brand"><div className="brand-mark">🌱</div><h1>Reset password</h1><p>Secure your Welfrise account with a new password.</p></div>
    {recoveryState === 'verifying' ? <div className="recovery-status" role="status" aria-live="polite">Verifying recovery link…</div> : null}
    {recoveryState === 'invalid' ? <div className="form"><div className="notice error" role="alert" aria-live="assertive">{linkError}</div><div className="secondary-link"><Link href="/login">Return to sign in</Link></div></div> : null}
    {recoveryState === 'ready' ? <form className="form" onSubmit={submit}>
      <div className="field"><label htmlFor="new-password">New password</label><PasswordInput id="new-password" minLength={PASSWORD_MIN_LENGTH} value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="new-password" disabled={busy} aria-describedby="password-requirements" /><small id="password-requirements">Use at least 12 characters.</small></div>
      <div className="field"><label htmlFor="confirm-password">Confirm password</label><PasswordInput id="confirm-password" minLength={PASSWORD_MIN_LENGTH} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required autoComplete="new-password" disabled={busy} /></div>
      {fieldError ? <div className="notice error" role="alert" aria-live="assertive">{fieldError}</div> : null}
      <button className="primary-button" disabled={busy}>{busy ? 'Updating password…' : 'Update password'}</button>
    </form> : null}
    {recoveryState === 'success' ? <div className="form"><div className="notice success" role="status" aria-live="polite">Your password has been updated. Sign in with your new password.</div><Link className="primary-link recovery-login-link" href="/login">Return to sign in</Link></div> : null}
  </section></main>
}
