'use client'

import { useState, type InputHTMLAttributes } from 'react'

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>

export function PasswordInput(props: PasswordInputProps) {
  const [visible, setVisible] = useState(false)
  const label = visible ? 'Hide password' : 'Show password'

  return <div className="password-input-wrap">
    <input {...props} type={visible ? 'text' : 'password'} />
    <button type="button" className="password-visibility-toggle" aria-label={label} aria-pressed={visible} onClick={() => setVisible((current) => !current)}>
      {visible ? 'Hide' : 'Show'}
    </button>
  </div>
}
