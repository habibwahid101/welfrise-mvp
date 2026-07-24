import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

const source = fs.readFileSync('src/lib/password-recovery.ts','utf8')
const javascript = ts.transpileModule(source,{ compilerOptions:{ module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022 } }).outputText
const recovery = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`)

test('recovery Auth errors classify provider and application limits as HTTP 429', () => {
  assert.deepEqual(recovery.classifyRecoveryError({ code:'over_email_send_rate_limit', status:429 }),{ kind:'rate',code:'over_email_send_rate_limit',status:429 })
  assert.equal(recovery.classifyRecoveryError(new Error('Rate limit exceeded')).kind,'rate')
})

test('email delivery and unexpected Auth failures are safely classified', () => {
  assert.equal(recovery.classifyRecoveryError({ code:'smtp_failure',status:502 }).kind,'delivery')
  assert.equal(recovery.classifyRecoveryError({ code:'bad_request',status:400 }).kind,'unexpected')
})

test('account-neutral recovery response never asserts an account exists', () => {
  assert.equal(recovery.RECOVERY_SUCCESS_MESSAGE,'If an account exists for this email, a password-reset link has been sent.')
  assert.equal(recovery.classifyRecoveryError({ code:'user_not_found',status:400 }).kind,'neutral')
})

test('recovery callback next validation blocks external and protocol-relative redirects', () => {
  assert.equal(recovery.safeRecoveryNext('/reset-password','recovery'),'/reset-password')
  assert.equal(recovery.safeRecoveryNext('https://evil.example','recovery'),'/reset-password')
  assert.equal(recovery.safeRecoveryNext('//evil.example',null),'/app')
  assert.equal(recovery.safeRecoveryNext('/app',null),'/app')
})

test('recovery diagnostics hash normalized email identifiers', async () => {
  const first = await recovery.recoveryEmailHash(' Test@Example.com ')
  const second = await recovery.recoveryEmailHash('test@example.com')
  assert.equal(first,second)
  assert.match(first,/^[a-f0-9]{16}$/)
  assert.doesNotMatch(first,/test|example/i)
})
