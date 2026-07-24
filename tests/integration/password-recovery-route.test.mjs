import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

function moduleUrl(source) { return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}` }
const helperJs = ts.transpileModule(fs.readFileSync('src/lib/password-recovery.ts','utf8'),{ compilerOptions:{ module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022 } }).outputText
const helperUrl = moduleUrl(helperJs)
const handlerTs = fs.readFileSync('src/lib/password-recovery-handler.ts','utf8').replace("'./password-recovery'",JSON.stringify(helperUrl))
const handlerJs = ts.transpileModule(handlerTs,{ compilerOptions:{ module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022 } }).outputText
const { createPasswordRecoveryHandler } = await import(moduleUrl(handlerJs))

function request(email='person@example.test',origin='https://welfrise-mvp.vercel.app') {
  return new Request(`${origin}/api/auth/password-recovery/request`,{ method:'POST',headers:{ origin,'content-type':'application/json' },body:JSON.stringify({email}) })
}

function harness({ providerError=null, rateError=null }={}) {
  const calls=[]; const logs=[]
  const client={ auth:{ resetPasswordForEmail:async(email,options)=>{ calls.push({email,options}); return {error:providerError} } } }
  const handler=createPasswordRecoveryHandler({
    createClient:async()=>client,
    rateLimit:async()=>{ if(rateError) throw rateError },
    log:(message,context)=>logs.push({message,context}),
  })
  return {handler,calls,logs}
}

test('valid and unknown-email recovery requests remain identically neutral', async () => {
  for (const [email, providerError] of [['member@example.test',null],['unknown@example.test',{code:'user_not_found',status:400}]]) {
    const testHarness=harness({providerError}); const response=await testHarness.handler(request(email)); const body=await response.json()
    assert.equal(response.status,200)
    assert.deepEqual(body,{ok:true,message:'If an account exists for this email, a password-reset link has been sent.'})
    assert.equal(testHarness.calls[0].options.redirectTo,'https://welfrise-mvp.vercel.app/auth/callback?next=/reset-password&flow=recovery')
    assert.equal(testHarness.logs.length,0)
  }
})

test('provider rate limits map to neutral HTTP 429 with a support reference', async () => {
  const testHarness=harness({providerError:{code:'over_email_send_rate_limit',status:429,message:'internal provider text'}})
  const response=await testHarness.handler(request()); const body=await response.json()
  assert.equal(response.status,429); assert.match(body.error,/temporarily limited/); assert.match(body.correlationId,/^[0-9a-f-]{36}$/)
  assert.doesNotMatch(JSON.stringify(body),/internal provider text|person@example/i)
})

test('provider delivery failures return safe HTTP 503 and safe diagnostics', async () => {
  const testHarness=harness({providerError:{code:'smtp_failure',status:502,message:'secret provider detail'}})
  const response=await testHarness.handler(request()); const body=await response.json(); const serialized=JSON.stringify(testHarness.logs)
  assert.equal(response.status,503); assert.match(body.error,/Reference:/)
  assert.match(serialized,/smtp_failure/); assert.match(serialized,/emailHash/)
  assert.doesNotMatch(serialized,/person@example|secret provider detail|access_token|refresh_token/i)
})

test('invalid payload and cross-origin requests fail before provider delivery', async () => {
  const testHarness=harness()
  assert.equal((await testHarness.handler(request('not-an-email'))).status,400)
  const foreign=new Request('https://welfrise-mvp.vercel.app/api/auth/password-recovery/request',{method:'POST',headers:{origin:'https://evil.example','content-type':'application/json'},body:'{"email":"person@example.test"}'})
  assert.equal((await testHarness.handler(foreign)).status,403)
  assert.equal(testHarness.calls.length,0)
})

test('application repeated-submission limits return HTTP 429 without provider call', async () => {
  const testHarness=harness({rateError:new Error('Rate limit exceeded')})
  const response=await testHarness.handler(request()); const body=await response.json()
  assert.equal(response.status,429); assert.match(body.error,/temporarily limited/); assert.equal(testHarness.calls.length,0)
})
