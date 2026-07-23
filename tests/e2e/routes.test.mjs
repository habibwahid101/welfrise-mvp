import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const kycForm = fs.readFileSync('src/app/app/kyc/kyc-form.tsx','utf8')
const kycPage = fs.readFileSync('src/app/app/kyc/page.tsx','utf8')
const styles = fs.readFileSync('src/app/globals.css','utf8')

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
