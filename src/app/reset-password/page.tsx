'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  hasRecoveryLinkParameters,
  INVALID_RECOVERY_LINK_MESSAGE,
  MISSING_RECOVERY_LINK_MESSAGE,
  PASSWORD_MIN_LENGTH,
  validateRecoveryPasswords,
} from '@/lib/password-recovery'

type RecoveryState = 'verifying' | 'ready' | 'invalid' | 'success'

function removeRecoveryCredentialsFromUrl() {
  window.history.replaceState(null, '', window.location.pathname)
}

export default function ResetPasswordPage() {
  const [recoveryState, setRecoveryState] = useState<RecoveryState>('verifying')
  const [linkError, setLinkError] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [fieldError, setFieldError] = useState('')
  const [busy, setBusy] = useState(false)
  const clientRef = useRef<ReturnType<typeof createClient> | null>(null)
  const submitBusyRef = useRef(false)

  useEffect(() => {
    let active = true
    let recoveryEventHandled = false
    let verificationTimer: number | undefined
    const recoveryAttempted = hasRecoveryLinkParameters(window.location.href)

    try {
      const supabase = createClient()
      clientRef.current = supabase
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        if (!active || event !== 'PASSWORD_RECOVERY') return
        recoveryEventHandled = true
        removeRecoveryCredentialsFromUrl()

        if (!recoveryAttempted) {
          setLinkError(MISSING_RECOVERY_LINK_MESSAGE)
          setRecoveryState('invalid')
          return
        }
        if (!session) {
          setLinkError(INVALID_RECOVERY_LINK_MESSAGE)
          setRecoveryState('invalid')
          return
        }

        setLinkError('')
        setRecoveryState('ready')
      })

      void supabase.auth.getSession().then(() => {
        verificationTimer = window.setTimeout(() => {
          if (!active || recoveryEventHandled) return
          if (recoveryAttempted) removeRecoveryCredentialsFromUrl()
          setLinkError(recoveryAttempted ? INVALID_RECOVERY_LINK_MESSAGE : MISSING_RECOVERY_LINK_MESSAGE)
          setRecoveryState('invalid')
        }, 250)
      }).catch(() => {
        if (!active) return
        if (recoveryAttempted) removeRecoveryCredentialsFromUrl()
        setLinkError(recoveryAttempted ? INVALID_RECOVERY_LINK_MESSAGE : MISSING_RECOVERY_LINK_MESSAGE)
        setRecoveryState('invalid')
      })

      return () => {
        active = false
        if (verificationTimer !== undefined) window.clearTimeout(verificationTimer)
        subscription.unsubscribe()
        clientRef.current = null
      }
    } catch {
      if (recoveryAttempted) removeRecoveryCredentialsFromUrl()
      verificationTimer = window.setTimeout(() => {
        if (!active) return
        setLinkError(recoveryAttempted ? INVALID_RECOVERY_LINK_MESSAGE : MISSING_RECOVERY_LINK_MESSAGE)
        setRecoveryState('invalid')
      }, 0)
      return () => {
        active = false
        if (verificationTimer !== undefined) window.clearTimeout(verificationTimer)
      }
    }
  }, [])

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitBusyRef.current || recoveryState !== 'ready') return

    const validationError = validateRecoveryPasswords(password, confirmation)
    if (validationError) {
      setFieldError(validationError)
      return
    }

    const supabase = clientRef.current
    if (!supabase) {
      setFieldError(INVALID_RECOVERY_LINK_MESSAGE)
      setRecoveryState('invalid')
      return
    }

    submitBusyRef.current = true
    setBusy(true)
    setFieldError('')
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) {
        setFieldError(INVALID_RECOVERY_LINK_MESSAGE)
        return
      }

      removeRecoveryCredentialsFromUrl()
      await supabase.auth.signOut({ scope: 'local' })
      setPassword('')
      setConfirmation('')
      setRecoveryState('success')
    } catch {
      setFieldError(INVALID_RECOVERY_LINK_MESSAGE)
    } finally {
      submitBusyRef.current = false
      setBusy(false)
    }
  }

  return (
    <main className="shell">
      <section className="auth-card recovery-card">
        <div className="brand">
          <div className="brand-mark">🌱</div>
          <h1>Reset password</h1>
          <p>Secure your Welfrise account with a new password.</p>
        </div>

        {recoveryState === 'verifying' ? <div className="recovery-status" role="status" aria-live="polite">Verifying recovery link…</div> : null}

        {recoveryState === 'invalid' ? <div className="form">
          <div className="notice error" role="alert" aria-live="assertive">{linkError}</div>
          <div className="secondary-link"><Link href="/login">Return to sign in</Link></div>
        </div> : null}

        {recoveryState === 'ready' ? <form className="form" onSubmit={submit}>
          <div className="field">
            <label htmlFor="new-password">New password</label>
            <input id="new-password" type="password" minLength={PASSWORD_MIN_LENGTH} value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="new-password" disabled={busy} aria-describedby="password-requirements" />
            <small id="password-requirements">Use at least 12 characters.</small>
          </div>
          <div className="field">
            <label htmlFor="confirm-password">Confirm password</label>
            <input id="confirm-password" type="password" minLength={PASSWORD_MIN_LENGTH} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required autoComplete="new-password" disabled={busy} />
          </div>
          {fieldError ? <div className="notice error" role="alert" aria-live="assertive">{fieldError}</div> : null}
          <button className="primary-button" disabled={busy}>{busy ? 'Updating password…' : 'Update password'}</button>
        </form> : null}

        {recoveryState === 'success' ? <div className="form">
          <div className="notice success" role="status" aria-live="polite">Your password has been updated. Sign in with your new password.</div>
          <Link className="primary-link recovery-login-link" href="/login">Return to sign in</Link>
        </div> : null}
      </section>
    </main>
  )
}
