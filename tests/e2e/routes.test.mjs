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
  assert.match(kycForm,/file exceeds the 5 MB limit/)
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

test('Admin Server Actions are import-compatible and expose only the six async actions', () => {
  const parsed = sourceFile(adminActionsPath,adminActions)
  const exportedAsyncFunctions = parsed.statements
    .filter((statement) => ts.isFunctionDeclaration(statement) && hasModifier(statement,ts.SyntaxKind.ExportKeyword) && hasModifier(statement,ts.SyntaxKind.AsyncKeyword))
    .map((statement) => statement.name.text)
    .sort()
  assert.deepEqual(exportedAsyncFunctions,[
    'adjustWalletBalance','createReceivingWallet','reviewBinancePayment','reviewWithdrawal','updateKycStatus','updateReceivingWalletStatus',
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
