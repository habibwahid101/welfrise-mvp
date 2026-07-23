'use client'

import { useState } from 'react'

export function CopyReferral({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  return <button className="ghost-button" type="button" onClick={async () => { await navigator.clipboard.writeText(code); setCopied(true); window.setTimeout(() => setCopied(false), 1500) }}>{copied ? 'Copied' : 'Copy'}</button>
}
