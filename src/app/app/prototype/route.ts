import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return new Response('<!doctype html><meta charset="utf-8"><script>top.location.href="/login"</script>', {
      status: 401,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
  }

  const filePath = path.join(process.cwd(), 'src', 'assets', 'prototype-connected.html')
  const html = await readFile(filePath, 'utf8')
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      'content-security-policy': "default-src 'self' https: data: blob: 'unsafe-inline' 'unsafe-eval'; frame-ancestors 'self';",
    },
  })
}
