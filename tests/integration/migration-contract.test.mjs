import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const sql = fs.readFileSync('supabase/migrations/20260723_003_security_integrity_and_admin_repair.sql','utf8')
const engine = fs.readFileSync('supabase/migrations/20260723_002_payment_wallet_engine.sql','utf8')

test('fresh user creation uses pgcrypto in extensions schema', () => { assert.match(sql,/extensions\.gen_random_bytes/); assert.match(sql,/set search_path = public, extensions, pg_temp/) })
test('invalid receiving wallet is rejected without relying on UI', () => assert.match(sql,/\^0x\[0-9a-fA-F\]\{40\}\$/))
test('duplicate receiving wallet casing is blocked', () => assert.match(sql,/unique index[^;]+upper\(network\),lower\(wallet_address\)/is))
test('expired Binance reservation is released exactly once', () => { assert.match(engine,/where status = 'awaiting_payment' and expires_at <= now\(\)/); assert.match(engine,/set status = 'expired', reserved_amount = 0/) })
test('duplicate transaction hash cannot fund another request', () => assert.match(engine,/binance_payment_tx_hash_unique[\s\S]+lower\(tx_hash\)/))
test('normal users cannot invoke legacy admin actions', () => { assert.match(sql,/revoke all on all functions in schema public from public,anon,authenticated/); assert.match(sql,/welfrise_require_admin_aal2/) })
test('admin mutation requires aal2 at the database boundary', () => assert.match(sql,/auth\.jwt\(\)->>'aal'[\s\S]+Admin MFA required/))
test('KYC paths are bound to authenticated user and submission', () => assert.match(sql,/v_user::text\|\|\/kyc\/|v_user::text\|\|'\/kyc\/'/))
test('ledger and audit history cannot be rewritten', () => { for (const table of ['wallet_ledger','financial_ledger','payout_events','admin_audit_log']) assert.match(sql,new RegExp(table)) ; assert.match(sql,/Historical records are append-only/) })
