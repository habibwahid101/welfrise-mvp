import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const kycForm = fs.readFileSync('src/app/app/kyc/kyc-form.tsx','utf8')
const kycPage = fs.readFileSync('src/app/app/kyc/page.tsx','utf8')
const styles = fs.readFileSync('src/app/globals.css','utf8')
const adminActionsPath = 'src/app/admin/actions.ts'
const adminActions = fs.readFileSync(adminActionsPath,'utf8')
const adminActionState = fs.readFileSync('src/app/admin/action-state.ts','utf8')
const adminForms = fs.readFileSync('src/app/admin/admin-forms.tsx','utf8')
const paymentCenter = fs.readFileSync('src/app/app/payments/payment-center.tsx','utf8')
const paymentPackageSource = fs.readFileSync('src/lib/payment-package.ts','utf8')
const binancePaymentRoute = fs.readFileSync('src/app/api/payments/binance/request/route.ts','utf8')
const userWalletPaymentRoute = fs.readFileSync('src/app/api/payments/user-wallet/route.ts','utf8')
const paymentDashboardRoute = fs.readFileSync('src/app/api/payments/dashboard/route.ts','utf8')
const adminPage = fs.readFileSync('src/app/admin/page.tsx','utf8')
const memberDashboard = fs.readFileSync('src/app/app/page.tsx','utf8')
const paymentMigration = fs.readFileSync('supabase/migrations/20260723_002_payment_wallet_engine.sql','utf8')
const loginPage = fs.readFileSync('src/app/login/page.tsx','utf8')
const resetPasswordPage = fs.readFileSync('src/app/reset-password/page.tsx','utf8')
const passwordRecoverySource = fs.readFileSync('src/lib/password-recovery.ts','utf8')
const fileValidationSource = fs.readFileSync('src/lib/file-validation.ts','utf8')
const kycRoute = fs.readFileSync('src/app/api/kyc/route.ts','utf8')
const binanceProofRoute = fs.readFileSync('src/app/api/payments/binance/submit/route.ts','utf8')

function sourceFile(file, source = fs.readFileSync(file,'utf8')) {
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
}

function hasModifier(node, kind) {
  return Boolean(node.modifiers?.some((modifier) => modifier.kind === kind))
}

function invalidUseServerExports(file) {
  const parsed = sourceFile(file)
  const invalid = []
  for (const statement of parsed.statements) {
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) continue
    if (ts.isExportDeclaration(statement)) {
      const typeOnly = statement.isTypeOnly || (statement.exportClause && ts.isNamedExports(statement.exportClause) && statement.exportClause.elements.every((element) => element.isTypeOnly))
      if (!typeOnly) invalid.push('runtime re-export')
      continue
    }
    if (!hasModifier(statement,ts.SyntaxKind.ExportKeyword)) continue
    if (ts.isFunctionDeclaration(statement) && hasModifier(statement,ts.SyntaxKind.AsyncKeyword)) continue
    invalid.push(statement.name?.getText(parsed) || ts.SyntaxKind[statement.kind])
  }
  return invalid
}

function sourceFiles(directory) {
  return fs.readdirSync(directory,{ withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory,entry.name)
    if (entry.isDirectory()) return sourceFiles(target)
    return /\.(?:[cm]?[jt]sx?)$/.test(entry.name) ? [target] : []
  })
}

function kycReviewFormSource() {
  return adminForms.slice(adminForms.indexOf('export function KycReviewForm'),adminForms.indexOf('export function WithdrawalReviewForm'))
}

function dataModule(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
}

async function loadAdminActionHarness() {
  const key = `__welfriseAdminActionHarness${Math.random().toString(36).slice(2)}`
  const state = { revalidated: [], rpcCalls: [] }
  globalThis[key] = state

  const revalidateModule = dataModule(`export function revalidatePath(path) { globalThis[${JSON.stringify(key)}].revalidated.push(path) }`)
  const safeErrorsModule = dataModule("export function errorMessage() { return 'Safe expected action error.' }")
  const supabaseModule = dataModule(`
    export async function createClient() {
      const state = globalThis[${JSON.stringify(key)}]
      return {
        auth: {
          getUser: async () => ({ data: { user: { id: 'admin-user' } } }),
          mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: 'aal2' }, error: null }) },
        },
        from: () => ({
          select() { return this },
          eq() { return this },
          single: async () => ({ data: { role: 'admin' }, error: null }),
        }),
        rpc: async (name,args) => { state.rpcCalls.push({ name,args }); return { error: null } },
      }
    }
  `)
  const javascript = ts.transpileModule(adminActions,{ compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
    .replace("'next/cache'",JSON.stringify(revalidateModule))
    .replace("'@/lib/supabase/server'",JSON.stringify(supabaseModule))
    .replace("'@/lib/safe-errors'",JSON.stringify(safeErrorsModule))
  const actions = await import(dataModule(javascript))
  return { actions, state, dispose: () => { delete globalThis[key] } }
}

async function loadPaymentPackageHarness() {
  const javascript = ts.transpileModule(paymentPackageSource,{ compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  return import(dataModule(javascript))
}

async function loadPasswordRecoveryHarness() {
  const javascript = ts.transpileModule(passwordRecoverySource,{ compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  return import(dataModule(javascript))
}

async function loadPaymentRouteHarness(routePath, routeSource) {
  const key = `__welfrisePaymentRouteHarness${Math.random().toString(36).slice(2)}`
  const state = { rpcCalls: [] }
  globalThis[key] = state

  const nextServerModule = dataModule(`
    export const NextResponse = {
      json(body,init = {}) { return { body, status: init.status || 200 } },
    }
  `)
  const safeErrorsModule = dataModule("export function mapSafeError() { return { message:'Safe payment error.', status:400 } }")
  const rateLimitModule = dataModule("export async function enforceRateLimit() {} export async function requestActorKey() { return 'actor' }")
  const supabaseModule = dataModule(`
    export async function createClient() {
      const state = globalThis[${JSON.stringify(key)}]
      return {
        auth: { getUser: async () => ({ data: { user: { id:'participant-id', email:'member@example.com' } } }) },
        rpc: async (name,args) => {
          state.rpcCalls.push({ name,args })
          if (name === 'create_binance_payment_request_v2') return { data: { request_id:'binance-request', wallet_address:'0xsecure', token:'USDT', network:'BEP20', expires_at:'2026-07-25T00:00:00Z' }, error:null }
          return { data: { id:'wallet-request', payer_display:'Wallet owner' }, error:null }
        },
      }
    }
  `)
  const packageJavascript = ts.transpileModule(paymentPackageSource,{ compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  const packageModule = dataModule(packageJavascript)
  const javascript = ts.transpileModule(routeSource,{ compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
    .replace("'next/server'",JSON.stringify(nextServerModule))
    .replace("'@/lib/supabase/server'",JSON.stringify(supabaseModule))
    .replace("'@/lib/safe-errors'",JSON.stringify(safeErrorsModule))
    .replace("'@/lib/rate-limit'",JSON.stringify(rateLimitModule))
    .replace("'@/lib/payment-package'",JSON.stringify(packageModule))
  const route = await import(dataModule(`${javascript}\n//# sourceURL=${routePath}`))
  return { route, state, dispose: () => { delete globalThis[key] } }
}

function paymentRequest(body) {
  return new Request('https://welfrise.example/api/payment',{
    method:'POST',
    headers:{ 'content-type':'application/json', 'idempotency-key':'payment-test-key' },
    body:JSON.stringify(body),
  })
}

test('/app is a native dashboard and the old prototype route redirects', () => {
  const dashboard=fs.readFileSync('src/app/app/page.tsx','utf8')
  const legacy=fs.readFileSync('src/app/app/prototype/route.ts','utf8')
  assert.doesNotMatch(dashboard,/<iframe|Sandbox MVP|src="\/app\/prototype"/)
  assert.match(dashboard,/Member dashboard/)
  assert.match(legacy,/redirect\(new URL\('\/app'/)
})

test('successful KYC handling never reads the synthetic form event after awaiting', () => {
  const submitHandler = kycForm.slice(kycForm.indexOf('async function submit'), kycForm.indexOf("if (submitted)"))
  assert.match(submitHandler,/const formElement = event\.currentTarget/)
  assert.doesNotMatch(submitHandler.slice(submitHandler.indexOf('await ')),/event\.currentTarget/)
})

test('KYC reset and FormData use the preserved form reference', () => {
  assert.match(kycForm,/const formData = new FormData\(formElement\)/)
  assert.match(kycForm,/formElement\.reset\(\)/)
  assert.doesNotMatch(kycForm,/event\.currentTarget\.reset\(\)/)
})

test('successful KYC submission immediately presents Pending and refreshes server data', () => {
  assert.match(kycForm,/<strong>KYC documents submitted successfully\.<\/strong> Your verification status is now Pending\./)
  assert.match(kycForm,/Status: <strong>Pending<\/strong>/)
  assert.match(kycForm,/setSubmitted\(true\)[\s\S]+router\.refresh\(\)/)
})

test('synchronous KYC busy guard prevents duplicate upload requests', () => {
  assert.match(kycForm,/if \(busy \|\| busyRef\.current \|\| !canSubmit\) return/)
  assert.match(kycForm,/busyRef\.current = true/)
  assert.equal((kycForm.match(/request\.send\(formData\)/g) || []).length,1)
})

test('KYC busy state disables every generated file input and the submit button', () => {
  assert.match(kycForm,/DOCUMENTS\.map/)
  assert.ok((kycForm.match(/disabled=\{!canSubmit \|\| busy\}/g) || []).length >= 2)
})

test('selected KYC files render name type size readiness and replacement feedback', () => {
  for (const text of ['Government-issued ID','Selfie','Proof of address','Replace file','Ready to upload']) assert.match(kycForm,new RegExp(text))
  assert.match(kycForm,/file\.name/)
  assert.match(kycForm,/formatFileType\(file\.type\)/)
  assert.match(kycForm,/formatFileSize\(file\.size\)/)
})

test('KYC upload exposes actual XHR progress and honest accessible stages', () => {
  for (const text of ['Preparing documents…','Uploading securely','Saving submission…']) assert.match(kycForm,new RegExp(text))
  assert.match(kycForm,/new XMLHttpRequest\(\)/)
  assert.match(kycForm,/request\.upload\.addEventListener\('progress'/)
  assert.match(kycForm,/role="progressbar"/)
  assert.match(kycForm,/aria-live="polite"/)
})

test('KYC file and upload failures remain readable inline alerts', () => {
  assert.match(kycForm,/unsupported file format/)
  assert.match(kycForm,/file exceeds the 4 MB limit/)
  assert.match(kycForm,/role="alert"/)
  assert.doesNotMatch(kycForm,/error instanceof Error \? error\.message/)
})

test('desktop KYC form uses the full panel and a three-column document grid', () => {
  assert.match(styles,/\.kyc-form \{ width: 100%; min-width: 0;/)
  assert.match(styles,/\.kyc-upload-grid \{[^}]*grid-template-columns: repeat\(3,minmax\(0,1fr\)\)/)
  assert.doesNotMatch(styles,/\.kyc-form \{[^}]*max-width: 720px/)
})

test('mobile KYC layout collapses without horizontal overflow', () => {
  assert.match(styles,/@media \(max-width: 560px\)[^\n]*\.kyc-upload-grid \{ grid-template-columns: 1fr; \}/)
  assert.match(styles,/\.kyc-upload-card \{[^}]*min-width: 0;/)
  assert.match(styles,/\.kyc-file-action \{[^}]*max-width: 100%;/)
})

test('Profile and KYC navigation includes Account Security', () => {
  assert.match(kycPage,/<Link href="\/account\/security">Account Security<\/Link>/)
})

test('every top-level use server module exports async functions only', () => {
  const useServerFiles = sourceFiles('src').filter((file) => /^\s*['"]use server['"]/.test(fs.readFileSync(file,'utf8')))
  assert.ok(useServerFiles.includes(path.normalize(adminActionsPath)))
  for (const file of useServerFiles) assert.deepEqual(invalidUseServerExports(file),[],`${file} contains an invalid runtime export`)
})

test('Admin Server Actions are import-compatible and expose only the eight async actions', () => {
  const parsed = sourceFile(adminActionsPath,adminActions)
  const exportedAsyncFunctions = parsed.statements
    .filter((statement) => ts.isFunctionDeclaration(statement) && hasModifier(statement,ts.SyntaxKind.ExportKeyword) && hasModifier(statement,ts.SyntaxKind.AsyncKeyword))
    .map((statement) => statement.name.text)
    .sort()
  assert.deepEqual(exportedAsyncFunctions,[
    'adjustWalletBalance','createPilotInvitation','createReceivingWallet','reviewBinancePayment','reviewWithdrawal','revokePilotInvitation','updateKycStatus','updateReceivingWalletStatus',
  ].sort())
  assert.match(adminForms,/from '\.\/actions'/)
  assert.match(adminForms,/initialActionResult, type ActionResult \} from '\.\/action-state'/)
  assert.doesNotMatch(adminActions,/export const|export class|export type|export interface/)
})

for (const [label,status] of [['Reject','rejected'],['Held','held'],['Approve','approved']]) {
  test(`KYC ${label} submits successfully through the authenticated review action`, async () => {
    assert.match(kycReviewFormSource(),new RegExp(`<option value="${status}">`))
    const harness = await loadAdminActionHarness()
    try {
      const formData = new FormData()
      formData.set('id','kyc-submission-id')
      formData.set('status',status)
      formData.set('reviewNote',`${label} review note`)
      formData.set('idempotencyKey',`${status}-idempotency-key`)
      const result = await harness.actions.updateKycStatus({ success:false, message:'' },formData)
      assert.deepEqual(result,{ success:true, message:'Saved successfully.' })
      assert.deepEqual(JSON.parse(JSON.stringify(result)),result)
      assert.deepEqual(harness.state.rpcCalls,[{
        name:'review_kyc_submission_v2',
        args:{
          p_submission_id:'kyc-submission-id',p_status:status,p_review_note:`${label} review note`,p_idempotency_key:`${status}-idempotency-key`,
        },
      }])
      assert.deepEqual(harness.state.revalidated,['/admin'])
    } finally {
      harness.dispose()
    }
  })
}

test('Server Action initial results remain serializable', async () => {
  const javascript = ts.transpileModule(adminActionState,{ compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  const stateModule = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`)
  assert.deepEqual(JSON.parse(JSON.stringify(stateModule.initialActionResult)),{ success:false, message:'' })
})

test('expected Admin action errors remain inline inside the KYC review row', () => {
  assert.match(kycReviewFormSource(),/<Notice state=\{state\} \/>/)
  assert.match(adminForms,/state\.message \? <div className=\{`action-notice/)
  assert.match(adminForms,/role=\{state\.success \? 'status' : 'alert'\}/)
})

test('successful Admin reviews revalidate and rerender the Admin page', () => {
  assert.match(adminActions,/await operation\(\)[\s\S]+revalidatePath\('\/admin'\)[\s\S]+return \{ success: true/)
})

test('rapid duplicate Admin review submission remains blocked while pending', () => {
  assert.match(adminForms,/const \{ pending \} = useFormStatus\(\)/)
  assert.match(adminForms,/disabled=\{pending \|\| disabled\}/)
  assert.match(kycReviewFormSource(),/onSubmit=\{prepare\}/)
  assert.match(adminForms,/if \(keyRef\.current && !keyRef\.current\.value\) keyRef\.current\.value = crypto\.randomUUID\(\)/)
})

// Approved Level / Slots / Amount payment structure: 22 regression checks.
test('payment 1/22: slot selector contains only 1, 2, 5, and 10', async () => {
  const paymentPackage = await loadPaymentPackageHarness()
  assert.deepEqual([...paymentPackage.ALLOWED_SLOT_COUNTS],[1,2,5,10])
  assert.match(paymentCenter,/Number of slots<select/)
  assert.doesNotMatch(paymentCenter,/<label>Package<select/)
})

test('payment 2/22: selecting 1 slot calculates and displays $10.00', async () => {
  const paymentPackage = await loadPaymentPackageHarness()
  assert.deepEqual(paymentPackage.calculatePaymentPackage(1),{ slots:1, amount:10 })
  assert.match(paymentCenter,/const totalAmount = slotCount \* SLOT_PRICE_USD/)
  assert.match(paymentCenter,/money\(totalAmount\)/)
})

test('payment 3/22: selecting 2 slots calculates and displays $20.00', async () => {
  const paymentPackage = await loadPaymentPackageHarness()
  assert.deepEqual(paymentPackage.calculatePaymentPackage(2),{ slots:2, amount:20 })
  assert.equal(`$${paymentPackage.calculatePaymentPackage(2).amount.toFixed(2)}`,'$20.00')
})

test('payment 4/22: selecting 5 slots calculates and displays $50.00', async () => {
  const paymentPackage = await loadPaymentPackageHarness()
  assert.deepEqual(paymentPackage.calculatePaymentPackage(5),{ slots:5, amount:50 })
  assert.equal(`$${paymentPackage.calculatePaymentPackage(5).amount.toFixed(2)}`,'$50.00')
})

test('payment 5/22: selecting 10 slots calculates and displays $100.00', async () => {
  const paymentPackage = await loadPaymentPackageHarness()
  assert.deepEqual(paymentPackage.calculatePaymentPackage(10),{ slots:10, amount:100 })
  assert.equal(`$${paymentPackage.calculatePaymentPackage(10).amount.toFixed(2)}`,'$100.00')
})

test('payment 6/22: total amount control is explicitly read-only and visibly styled', () => {
  assert.match(paymentCenter,/<label>Total amount<input value=\{money\(totalAmount\)\} readOnly aria-readonly="true" \/><\/label>/)
  assert.match(styles,/\.payment-fields input\[readonly\] \{[^}]*background:[^}]*font-weight:/)
})

test('payment 7/22: user cannot manually change the amount or submit it as authority', () => {
  const totalAmountControl = paymentCenter.match(/<label>Total amount<input[^>]+>/)?.[0] || ''
  assert.doesNotMatch(totalAmountControl,/onChange=/)
  assert.match(paymentCenter,/body: JSON\.stringify\(\{ slots: slotCount, level \}\)/)
  assert.match(paymentCenter,/body: JSON\.stringify\(\{ payerIdentifier, slots: slotCount, level \}\)/)
})

test('payment 8/22: wallet-owner identifier field is conditional on User Wallet', () => {
  assert.match(paymentCenter,/method === 'user-wallet' \? <label className="payment-owner-field">Wallet owner ID, referral code, or email/)
  assert.match(paymentCenter,/placeholder="Enter wallet owner identifier"/)
})

test('payment 9/22: Binance flow does not render the wallet-owner field', () => {
  assert.doesNotMatch(paymentCenter,/method === 'binance' \? <label[^>]*>Wallet owner ID/)
  assert.equal((paymentCenter.match(/Wallet owner ID, referral code, or email<input/g) || []).length,1)
})

test('payment 10/22: User Wallet action is disabled until an owner identifier is entered', () => {
  assert.match(paymentCenter,/method === 'user-wallet' && !payerIdentifier\.trim\(\)/)
  assert.match(paymentCenter,/disabled=\{Boolean\(paymentDisabledReason\)\}/)
  assert.match(paymentCenter,/Enter the wallet owner ID, referral code, or email\./)
})

test('payment 11/22: both servers derive the RPC amount from slot count', async () => {
  for (const [routePath,routeSource,rpcName,extra] of [
    ['binance/request/route.ts',binancePaymentRoute,'create_binance_payment_request_v2',{}],
    ['user-wallet/route.ts',userWalletPaymentRoute,'create_user_wallet_payment_request_v2',{ payerIdentifier:'OWNER-CODE' }],
  ]) {
    const harness = await loadPaymentRouteHarness(routePath,routeSource)
    try {
      const response = await harness.route.POST(paymentRequest({ ...extra, level:2, slots:5 }))
      assert.equal(response.status,200)
      assert.equal(harness.state.rpcCalls[0].name,rpcName)
      assert.equal(harness.state.rpcCalls[0].args.p_slots,5)
      assert.equal(harness.state.rpcCalls[0].args.p_amount,50)
    } finally { harness.dispose() }
  }
})

test('payment 12/22: manipulated client amounts cannot alter either server-calculated amount', async () => {
  for (const [routePath,routeSource,extra] of [
    ['binance/request/route.ts',binancePaymentRoute,{}],
    ['user-wallet/route.ts',userWalletPaymentRoute,{ payerIdentifier:'OWNER-CODE' }],
  ]) {
    const harness = await loadPaymentRouteHarness(routePath,routeSource)
    try {
      const response = await harness.route.POST(paymentRequest({ ...extra, level:1, slots:1, amount:100 }))
      assert.equal(response.status,400)
      assert.deepEqual(response.body,{ error:'Invalid package' })
      assert.equal(harness.state.rpcCalls.length,0)
    } finally { harness.dispose() }
  }
})

test('payment 13/22: invalid slot counts are rejected before either RPC executes', async () => {
  for (const [routePath,routeSource,extra] of [
    ['binance/request/route.ts',binancePaymentRoute,{}],
    ['user-wallet/route.ts',userWalletPaymentRoute,{ payerIdentifier:'OWNER-CODE' }],
  ]) {
    const harness = await loadPaymentRouteHarness(routePath,routeSource)
    try {
      const response = await harness.route.POST(paymentRequest({ ...extra, level:1, slots:3 }))
      assert.equal(response.status,400)
      assert.deepEqual(response.body,{ error:'Invalid package' })
      assert.equal(harness.state.rpcCalls.length,0)
    } finally { harness.dispose() }
  }
})

test('payment 14/22: outgoing requests display Level, Slots, and Amount separately', () => {
  const outgoing = paymentCenter.slice(paymentCenter.indexOf('Your outgoing wallet requests'),paymentCenter.indexOf('Withdraw funds'))
  for (const label of ['<dt>Level</dt>','<dt>Slots</dt>','<dt>Amount</dt>']) assert.match(outgoing,new RegExp(label))
  assert.doesNotMatch(outgoing,/Level\/package|money\(item\.amount\).*Level/)
})

test('payment 15/22: incoming approval cards show all decision-critical values separately', () => {
  const incoming = paymentCenter.slice(paymentCenter.indexOf('Requests needing your approval'),paymentCenter.indexOf('Your outgoing wallet requests'))
  for (const label of ['Participant','Level','Slots','Amount requested','Current available balance','Balance after approval','Commission']) assert.match(incoming,new RegExp(`<dt>${label}</dt>`))
  assert.match(incoming,/\? 'Approving…' : 'Approve'/)
  assert.match(incoming,/\? 'Declining…' : 'Decline'/)
})

test('payment 16/22: Admin payment tables separate Level, Slots, and Amount', () => {
  assert.ok((adminPage.match(/<th>Level<\/th><th>Slots<\/th><th>Amount<\/th>/g) || []).length >= 2)
  assert.doesNotMatch(adminPage,/<th>Level\/package<\/th>/)
  assert.doesNotMatch(adminPage,/money\(item\.amount\) · \{item\.slots\} slots/)
})

test('payment 17/22: commission copy follows the participant registered referrer', () => {
  assert.match(paymentCenter,/Commission goes to the participant’s registered referrer\./)
  assert.match(paymentCenter,/wallet owner supplies the balance only/)
  assert.match(paymentCenter,/wallet owner does not receive the referral commission unless/)
  assert.match(paymentCenter,/Follows the participant’s registered referrer after approval\./)
})

test('payment 18/22: a synchronous guard prevents rapid duplicate payment submissions', () => {
  assert.match(paymentCenter,/if \(mutationBusyRef\.current\) return/)
  assert.match(paymentCenter,/mutationBusyRef\.current = true[\s\S]+setBusy\('create'\)/)
  assert.match(paymentCenter,/finally \{[\s\S]*mutationBusyRef\.current = false[\s\S]*setBusy\(''\)/)
  assert.equal((paymentCenter.match(/jsonRequest\('\/api\/payments\/binance\/request'/g) || []).length,1)
  assert.equal((paymentCenter.match(/jsonRequest\('\/api\/payments\/user-wallet'/g) || []).length,2)
})

test('payment 19/22: existing pending requests remain compatible with structured displays', () => {
  assert.match(paymentDashboardRoute,/wallet_payment_requests'\)\.select\('id,participant_id,payer_id,participant_display,payer_display,amount,slots,level_id/)
  assert.match(memberDashboard,/select\('id,participant_display,amount,slots,level_id,status,expires_at'\)/)
  assert.match(memberDashboard,/Level: \{item\.level_id\} · Slots: \{item\.slots\}/)
  assert.match(paymentCenter,/dashboard!\.incomingWalletRequests\.map/)
  assert.match(paymentCenter,/dashboard!\.outgoingWalletRequests\.map/)
})

test('payment 20/22: desktop and tablet payment layouts are balanced at three and two columns', () => {
  assert.match(styles,/\.payment-fields \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); \}/)
  assert.match(styles,/@media \(max-width: 820px\) \{[\s\S]*\.payment-fields, \.payment-summary-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/)
  assert.match(styles,/\.payment-owner-field \{ grid-column: 1 \/ -1; \}/)
})

test('payment 21/22: mobile layout is one column with full-width overflow-safe controls', () => {
  assert.match(styles,/@media \(max-width: 560px\) \{[\s\S]*\.portal-metrics, \.form-grid[^}]*grid-template-columns: 1fr;/)
  assert.match(styles,/\.portal-action \{ width: 100%; \}/)
  assert.match(styles,/\.request-card \{ min-width: 0;/)
  assert.match(styles,/\.request-address \{[^}]*overflow-wrap: anywhere;/)
})

test('payment 22/22: locked financial, referral, FIFO, payout, and championship rules remain intact', () => {
  assert.match(paymentMigration,/when 1 then 20::numeric/)
  assert.match(paymentMigration,/if v_waiting \+ p_slots > 10 then/)
  assert.match(paymentMigration,/mod\(v_position - 1, 10\) = 0/)
  assert.match(paymentMigration,/order by level_position[\s\S]*for update[\s\S]*limit 1/)
  assert.match(paymentMigration,/welfrise_valid_referrer\(p_participant\)/)
  assert.match(paymentMigration,/Global Charity Fund/)
  assert.match(paymentMigration,/v_fee := round\(p_gross_amount \* 0\.05, 2\)/)
  assert.match(paymentMigration,/championship_status = 'completed'/)
})

test('password recovery targets the public /reset-password production route', () => {
  assert.match(loginPage,/supabase\.auth\.resetPasswordForEmail\(recoveryEmail\.trim\(\)\.toLowerCase\(\), \{/)
  assert.match(loginPage,/redirectTo: `\$\{window\.location\.origin\}\/reset-password`/)
  assert.match(resetPasswordPage,/export default function ResetPasswordPage/)
})

test('password recovery request always uses neutral anti-enumeration copy', () => {
  const neutral = 'If an account exists for this email, a password-reset link has been sent.'
  assert.match(loginPage,new RegExp(neutral.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')))
  assert.match(loginPage,/catch \{[\s\S]*response remains deliberately neutral[\s\S]*finally \{[\s\S]*setRecoveryMessage\(RECOVERY_REQUEST_MESSAGE\)/)
  assert.doesNotMatch(loginPage,/resetPasswordForEmail[\s\S]*error\.message/)
})

test('valid PASSWORD_RECOVERY session unlocks the reset form', () => {
  assert.match(resetPasswordPage,/onAuthStateChange\(\(event, session\) => \{/)
  assert.match(resetPasswordPage,/event !== 'PASSWORD_RECOVERY'/)
  assert.match(resetPasswordPage,/if \(!session\)[\s\S]*setRecoveryState\('invalid'\)/)
  assert.match(resetPasswordPage,/setRecoveryState\('ready'\)/)
  assert.match(resetPasswordPage,/Verifying recovery link…/)
})

test('invalid expired used and missing recovery links show fixed inline errors', async () => {
  const recovery = await loadPasswordRecoveryHarness()
  assert.equal(recovery.hasRecoveryLinkParameters('https://welfrise.example/reset-password?error_code=otp_expired'),true)
  assert.equal(recovery.hasRecoveryLinkParameters('https://welfrise.example/reset-password'),false)
  assert.match(recovery.INVALID_RECOVERY_LINK_MESSAGE,/invalid, expired, or has already been used/)
  assert.match(recovery.MISSING_RECOVERY_LINK_MESSAGE,/No password recovery link was found/)
  assert.match(resetPasswordPage,/className="notice error" role="alert"/)
  assert.doesNotMatch(resetPasswordPage,/error\.message|console\.|stack/)
})

test('new recovery password requires at least 12 characters', async () => {
  const recovery = await loadPasswordRecoveryHarness()
  assert.equal(recovery.PASSWORD_MIN_LENGTH,12)
  assert.equal(recovery.validateRecoveryPasswords('short','short'),'Password must be at least 12 characters.')
  assert.match(resetPasswordPage,/minLength=\{PASSWORD_MIN_LENGTH\}/)
})

test('password confirmation mismatch is rejected inline before update', async () => {
  const recovery = await loadPasswordRecoveryHarness()
  assert.equal(recovery.validateRecoveryPasswords('abcdefghijkl','abcdefghijkm'),'Passwords do not match.')
  assert.match(resetPasswordPage,/const validationError = validateRecoveryPasswords\(password, confirmation\)/)
  assert.match(resetPasswordPage,/if \(validationError\) \{[\s\S]*setFieldError\(validationError\)[\s\S]*return/)
})

test('successful recovery updates the authenticated user password', () => {
  assert.match(resetPasswordPage,/await supabase\.auth\.updateUser\(\{ password \}\)/)
  assert.match(resetPasswordPage,/if \(error\) \{[\s\S]*setFieldError\(INVALID_RECOVERY_LINK_MESSAGE\)[\s\S]*return/)
  assert.match(resetPasswordPage,/setRecoveryState\('success'\)/)
})

test('recovery credentials and URL fragments are removed from browser history', async () => {
  const recovery = await loadPasswordRecoveryHarness()
  assert.equal(recovery.hasRecoveryLinkParameters('https://welfrise.example/reset-password#access_token=secret&refresh_token=secret&type=recovery'),true)
  assert.match(resetPasswordPage,/window\.history\.replaceState\(null, '', window\.location\.pathname\)/)
  assert.ok((resetPasswordPage.match(/removeRecoveryCredentialsFromUrl\(\)/g) || []).length >= 4)
  assert.doesNotMatch(resetPasswordPage,/access_token\}|refresh_token\}|token_hash\}/)
})

test('successful password recovery signs out locally and returns to login', () => {
  assert.match(resetPasswordPage,/await supabase\.auth\.signOut\(\{ scope: 'local' \}\)/)
  assert.match(resetPasswordPage,/<Link className="primary-link recovery-login-link" href="\/login">Return to sign in<\/Link>/)
  assert.match(resetPasswordPage,/Your password has been updated\. Sign in with your new password\./)
})

test('password recovery mobile layout is full-width and overflow-safe', () => {
  assert.match(styles,/\.auth-card \{[\s\S]*min-width: 0;/)
  assert.match(styles,/\.recovery-card \{ overflow-wrap: anywhere; \}/)
  assert.match(styles,/@media \(max-width: 480px\) \{[\s\S]*\.shell \{ padding: 14px; \}[\s\S]*\.auth-card \{ width: 100%;/)
  assert.match(styles,/\.recovery-card input, \.recovery-card button, \.recovery-card a \{ max-width: 100%; \}/)
})

test('private uploads remain below the Vercel Function request ceiling', () => {
  assert.match(fileValidationSource,/MAX_PRIVATE_DOCUMENT_BYTES = 4_000_000/)
  assert.match(fileValidationSource,/MAX_KYC_SUBMISSION_BYTES = 4_000_000/)
  assert.match(kycRoute,/assertKycSubmissionSize/)
  assert.match(kycForm,/MAX_KYC_SUBMISSION_BYTES = 4_000_000/)
  assert.match(kycForm,/selectedBytes > MAX_KYC_SUBMISSION_BYTES/)
})

test('Binance proof submissions require a canonical EVM transaction hash', () => {
  assert.match(binanceProofRoute,/\^0x\[0-9a-fA-F\]\{64\}\$/)
  assert.match(paymentCenter,/pattern="\^0x\[a-fA-F0-9\]\{64\}\$"/)
})

test('an expired proof submission is cleaned up and returned as a conflict', () => {
  assert.match(binanceProofRoute,/if \(data === 'expired'\)/)
  assert.match(binanceProofRoute,/remove\(\[proofPath\]\)/)
  assert.match(binanceProofRoute,/status: 409/)
})

test('payment mutation idempotency keys survive a same-page retry', () => {
  assert.match(paymentCenter,/const mutationKeysRef = useRef\(new Map<string, string>\(\)\)/)
  assert.match(paymentCenter,/function mutationHeaders\(operation: string/)
  assert.match(paymentCenter,/mutationKeysRef\.current\.get\(operation\)/)
  assert.match(paymentCenter,/function clearMutationKey\(operation: string\)/)
})
