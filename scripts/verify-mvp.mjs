import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const checks = []

function check(name, condition) {
  checks.push({ name, pass: Boolean(condition) })
}

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8')
}

const migration = read('supabase/migrations/20260723_002_payment_wallet_engine.sql')
const prototype = read('src/assets/prototype-connected.html')
const packageJson = JSON.parse(read('package.json'))

check('Project is branded Welfrise', packageJson.name === 'welfrise-mvp' && !/KIMI TROPHY|KIMI Trophy/.test(prototype))
check('Level 1 payout is $20', /when 1 then 20::numeric/.test(migration))
check('Other payouts are unchanged', /when 2 then 100::numeric/.test(migration) && /when 3 then 1000::numeric/.test(migration) && /when 4 then 10000::numeric/.test(migration) && /when 5 then 100000::numeric/.test(migration))
check('Withdrawal fee is 5%', /p_gross_amount \* 0\.05/.test(migration))
check('Binance wallet rotation exists', /create_binance_payment_request/.test(migration) && /capacity_limit - (?:rw\.)?confirmed_amount - (?:rw\.)?reserved_amount/.test(migration))
check('Only assigned wallet address is returned', /assigned_wallet_address/.test(migration) && /wallet_address text/.test(migration))
check('User-wallet authorization exists', /create_user_wallet_payment_request/.test(migration) && /respond_user_wallet_payment_request/.test(migration))
check('Commission follows participant referrer', /welfrise_valid_referrer\(p_participant\)/.test(migration) && /referral_to_charity/.test(migration))
check('Ten waiting-slot cap exists', /exceeds the ten active waiting-slot limit/.test(migration))
check('FIFO payout timing exists', /mod\(v_position - 1, 10\) = 0/.test(migration))
check('Level 5 completes the current cycle', /set championship_status = 'completed'/.test(migration) && /championship_completed_at = now\(\)/.test(migration))
check('New cycles require a paid Level 1 entry', /new paid Level 1 entry for the next cycle/.test(migration) && /highest_unlocked_level = 1/.test(migration))
check('Payment cycle is derived server-side', /v_cycle := v_profile\.championship_cycle \+ 1/.test(migration) && /v_cycle := v_profile\.championship_cycle;/.test(migration))
check('Direct contribution bypass is disabled', /status: 410/.test(read('src/app/api/contributions/route.ts')))
check('Private storage bucket exists', /welfrise-private/.test(migration))
check('Payment center exists', fs.existsSync(path.join(root, 'src/app/app/payments/payment-center.tsx')))
check('Admin wallet controls exist', /admin_create_receiving_wallet/.test(migration) && /review_binance_payment/.test(migration))

const scriptBodies = [...prototype.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map((match) => match[1])
let scriptSyntax = true
for (const body of scriptBodies) {
  try { new Function(body) } catch { scriptSyntax = false }
}
check('Prototype JavaScript parses', scriptSyntax)

const failed = checks.filter((item) => !item.pass)
for (const item of checks) console.log(`${item.pass ? 'PASS' : 'FAIL'}  ${item.name}`)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
if (failed.length) process.exit(1)
