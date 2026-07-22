'use client'

import Link from 'next/link'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function RegisterPage() {
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', referral: '' })
  const [message, setMessage] = useState('')
  const [success, setSuccess] = useState(false)
  const [busy, setBusy] = useState(false)

  function update(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    setSuccess(false)
    try {
      const supabase = createClient()
      const emailRedirectTo = `${window.location.origin}/auth/callback`
      const { data, error } = await supabase.auth.signUp({
        email: form.email,
        password: form.password,
        options: {
          emailRedirectTo,
          data: {
            full_name: form.name,
            phone: form.phone,
            referral_code_used: form.referral || null,
          },
        },
      })
      if (error) throw error
      if (data.session) {
        window.location.href = '/app'
        return
      }
      setSuccess(true)
      setMessage('Registration received. Check your email to confirm the account, then sign in.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to create the account.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="shell">
      <section className="auth-card">
        <div className="brand">
          <div className="brand-mark">🌱</div>
          <h1>Create account</h1>
          <p>Give. Grow. Rise. · Level 1 starts unlocked</p>
        </div>
        <form className="form" onSubmit={submit}>
          <div className="field"><label htmlFor="name">Full name</label><input id="name" value={form.name} onChange={(e) => update('name', e.target.value)} required /></div>
          <div className="field"><label htmlFor="email">Email</label><input id="email" type="email" value={form.email} onChange={(e) => update('email', e.target.value)} required /></div>
          <div className="field"><label htmlFor="phone">Phone</label><input id="phone" value={form.phone} onChange={(e) => update('phone', e.target.value)} required /></div>
          <div className="field"><label htmlFor="password">Password</label><input id="password" type="password" minLength={8} value={form.password} onChange={(e) => update('password', e.target.value)} required /></div>
          <div className="field"><label htmlFor="referral">Referral code (optional)</label><input id="referral" value={form.referral} onChange={(e) => update('referral', e.target.value)} /></div>
          {message ? <div className={`notice ${success ? 'success' : 'error'}`}>{message}</div> : null}
          <button className="primary-button" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
          <div className="secondary-link">Already registered? <Link href="/login">Sign in</Link></div>
        </form>
      </section>
    </main>
  )
}
