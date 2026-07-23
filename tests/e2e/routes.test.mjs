import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('/app is a native dashboard and the old prototype route redirects', () => {
  const dashboard=fs.readFileSync('src/app/app/page.tsx','utf8')
  const legacy=fs.readFileSync('src/app/app/prototype/route.ts','utf8')
  assert.doesNotMatch(dashboard,/<iframe|Sandbox MVP|src="\/app\/prototype"/)
  assert.match(dashboard,/Member dashboard/)
  assert.match(legacy,/redirect\(new URL\('\/app'/)
})
