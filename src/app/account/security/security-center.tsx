'use client'

import Image from 'next/image'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Factor = { id: string; friendly_name?: string; status: string; factor_type: string }
type Enrollment = { id: string; qrCode: string; secret: string }

export default function SecurityCenter({ isAdmin }: { isAdmin: boolean }) {
  const [factors, setFactors] = useState<Factor[]>([])
  const [level, setLevel] = useState('aal1')
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)

  async function refresh() {
    const supabase = createClient()
    const [factorResult, aalResult] = await Promise.all([
      supabase.auth.mfa.listFactors(),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    ])
    if (factorResult.error) throw factorResult.error
    if (aalResult.error) throw aalResult.error
    setFactors((factorResult.data?.all || []) as Factor[])
    setLevel(aalResult.data?.currentLevel || 'aal1')
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh().catch(() => setNotice({ kind: 'error', message: 'Unable to load security settings.' })) }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  async function enroll() {
    setBusy('enroll'); setNotice(null)
    try {
      const { data, error } = await createClient().auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Welfrise authenticator' })
      if (error) throw error
      setEnrollment({ id: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret })
    } catch { setNotice({ kind: 'error', message: 'Unable to start MFA enrollment.' }) }
    finally { setBusy('') }
  }

  async function verify(factorId: string) {
    setBusy('verify'); setNotice(null)
    try {
      const { error } = await createClient().auth.mfa.challengeAndVerify({ factorId, code: code.trim() })
      if (error) throw error
      setEnrollment(null); setCode('')
      await refresh()
      setNotice({ kind: 'success', message: 'MFA verified. This session now meets AAL2.' })
    } catch { setNotice({ kind: 'error', message: 'The verification code was not accepted.' }) }
    finally { setBusy('') }
  }

  async function updatePassword(event: React.FormEvent) {
    event.preventDefault(); setBusy('password'); setNotice(null)
    try {
      if (password.length < 12) throw new Error('short')
      const { error } = await createClient().auth.updateUser({ password })
      if (error) throw error
      setPassword(''); setNotice({ kind: 'success', message: 'Password updated.' })
    } catch { setNotice({ kind: 'error', message: 'Use a password of at least 12 characters.' }) }
    finally { setBusy('') }
  }

  const verified = factors.find((factor) => factor.factor_type === 'totp' && factor.status === 'verified')

  return (
    <div className="portal-stack">
      {notice ? <div className={`notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'} aria-live="polite">{notice.message}</div> : null}
      <section className="portal-panel">
        <h2>Multi-factor authentication</h2>
        <p>Current session: <strong>{level.toUpperCase()}</strong>. {isAdmin ? 'Administrators must verify MFA before financial or KYC changes.' : 'MFA adds protection to your account.'}</p>
        {isAdmin && level !== 'aal2' ? <div className="notice error" role="alert">Complete MFA verification to continue with admin mutations.</div> : null}
        {!verified && !enrollment ? <button className="primary-button portal-action" disabled={busy === 'enroll'} onClick={() => void enroll()}>{busy === 'enroll' ? 'Preparing…' : 'Set up authenticator app'}</button> : null}
        {enrollment ? <div className="mfa-enrollment">
          <Image src={enrollment.qrCode} alt="Authenticator enrollment QR code" width={220} height={220} unoptimized />
          <p>Scan the QR code in your authenticator app, or enter this secret:</p><code>{enrollment.secret}</code>
          <div className="field"><label htmlFor="totpCode">Six-digit verification code</label><input id="totpCode" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" value={code} onChange={(event) => setCode(event.target.value)} /></div>
          <button className="primary-button" disabled={busy === 'verify' || !/^[0-9]{6}$/.test(code)} onClick={() => void verify(enrollment.id)}>{busy === 'verify' ? 'Verifying…' : 'Verify and enable MFA'}</button>
        </div> : null}
        {verified && level !== 'aal2' ? <div className="mfa-enrollment"><p>Enter the current code from your authenticator app to elevate this session.</p><div className="field"><label htmlFor="stepUpCode">Six-digit verification code</label><input id="stepUpCode" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" value={code} onChange={(event) => setCode(event.target.value)} /></div><button className="primary-button" disabled={busy === 'verify' || !/^[0-9]{6}$/.test(code)} onClick={() => void verify(verified.id)}>{busy === 'verify' ? 'Verifying…' : 'Verify MFA'}</button></div> : null}
        {verified && level === 'aal2' ? <div className="notice success" role="status">MFA is enabled and this session is verified.</div> : null}
      </section>
      <section className="portal-panel">
        <h2>Change password</h2>
        <form className="form" onSubmit={updatePassword}><div className="field"><label htmlFor="newPassword">New password</label><input id="newPassword" type="password" minLength={12} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required /><span className="small-muted">Use at least 12 characters.</span></div><button className="primary-button portal-action" disabled={busy === 'password'}>{busy === 'password' ? 'Updating…' : 'Update password'}</button></form>
      </section>
    </div>
  )
}
