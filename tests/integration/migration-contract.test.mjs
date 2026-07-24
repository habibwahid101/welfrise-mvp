import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const sql = fs.readFileSync('supabase/migrations/20260723_003_security_integrity_and_admin_repair.sql','utf8')
const engine = fs.readFileSync('supabase/migrations/20260723_002_payment_wallet_engine.sql','utf8')
const driftRepair = fs.readFileSync('supabase/migrations/20260723_004_profile_championship_schema_drift_repair.sql','utf8')
const treasuryPrivilegeRepair = fs.readFileSync('supabase/migrations/20260723_005_treasury_view_function_privilege_repair.sql','utf8')
const authorizationHardeningPath = 'supabase/migrations/20260724_006_authorization_and_financial_integrity_hardening.sql'
const authorizationHardening = fs.existsSync(authorizationHardeningPath)
  ? fs.readFileSync(authorizationHardeningPath,'utf8')
  : ''
const invitationManagement = fs.readFileSync('supabase/migrations/20260724_007_pilot_invitation_management.sql','utf8')

test('fresh user creation uses pgcrypto in extensions schema', () => { assert.match(sql,/extensions\.gen_random_bytes/); assert.match(sql,/set search_path = public, extensions, pg_temp/) })
test('invalid receiving wallet is rejected without relying on UI', () => assert.match(sql,/\^0x\[0-9a-fA-F\]\{40\}\$/))
test('duplicate receiving wallet casing is blocked', () => assert.match(sql,/unique index[^;]+upper\(network\),lower\(wallet_address\)/is))
test('expired Binance reservation is released exactly once', () => { assert.match(engine,/where status = 'awaiting_payment' and expires_at <= now\(\)/); assert.match(engine,/set status = 'expired', reserved_amount = 0/) })
test('duplicate transaction hash cannot fund another request', () => assert.match(engine,/binance_payment_tx_hash_unique[\s\S]+lower\(tx_hash\)/))
test('normal users cannot invoke legacy admin actions', () => { assert.match(sql,/revoke all on all functions in schema public from public,anon,authenticated/); assert.match(sql,/welfrise_require_admin_aal2/) })
test('admin mutation requires aal2 at the database boundary', () => assert.match(sql,/auth\.jwt\(\)->>'aal'[\s\S]+Admin MFA required/))
test('KYC paths are bound to authenticated user and submission', () => assert.match(sql,/v_user::text\|\|\/kyc\/|v_user::text\|\|'\/kyc\/'/))
test('ledger and audit history cannot be rewritten', () => { for (const table of ['wallet_ledger','financial_ledger','payout_events','admin_audit_log']) assert.match(sql,new RegExp(table)) ; assert.match(sql,/Historical records are append-only/) })
test('profile championship schema drift repair is idempotent', () => { for (const column of ['championship_cycle','championship_status','championship_completed_at']) assert.match(driftRepair,new RegExp(column)); assert.match(driftRepair,/add column if not exists/) })
test('Treasury view payout helper execution is restored for authenticated users', () => { assert.match(treasuryPrivilegeRepair,/welfrise_payout_for_level\(integer\)/); assert.match(treasuryPrivilegeRepair,/grant execute/); assert.match(treasuryPrivilegeRepair,/authenticated/) })
test('Migration 007 stores hashed one-time invitation codes and enforces AAL2 audited idempotent mutations', () => {
  assert.match(invitationManagement,/extensions\.crypt\(v_code,extensions\.gen_salt/)
  assert.match(invitationManagement,/welfrise_require_admin_aal2\(\)/)
  assert.match(invitationManagement,/pilot_invitation_create[\s\S]+p_idempotency_key/)
  assert.match(invitationManagement,/pilot_invitation_created[\s\S]+admin_audit_log/)
  assert.match(invitationManagement,/insert into public\.pilot_invitations\(email,code_hash,expires_at,created_by\)/i)
})

test('the database accepts only the four locked slot packages and derives exact amounts', () => {
  for (const [amount, slots] of [[10,1],[20,2],[50,5],[100,10]]) {
    assert.match(engine,new RegExp(`p_amount = ${amount} and p_slots = ${slots}`))
  }
  assert.match(engine,/if not public\.welfrise_validate_package\(p_amount, p_slots\) then/)
})

test('each approved slot posts the exact locked financial allocation', () => {
  assert.match(engine,/\('participation_contribution', 10, 'credit'/)
  assert.match(engine,/\('charity_allocation', 1, 'allocation'/)
  assert.match(engine,/\('level_bonus_reserve', 4\.50, 'allocation'/)
  assert.match(engine,/\('platform_operations_reserve', 3\.50, 'allocation'/)
  assert.match(engine,/'referral_commission', 1, 'credit'/)
  assert.match(engine,/'referral_to_charity', 1, 'allocation'/)
})

test('referral commission is bound to the registered active referrer with charity fallback', () => {
  assert.match(engine,/join public\.profiles r on r\.id = p\.referred_by/)
  assert.match(engine,/r\.account_status = 'active'/)
  assert.match(engine,/if v_referrer is not null then[\s\S]+else[\s\S]+referral_to_charity/)
})

test('wallet authorization checks funds and settles at most once under row lock', () => {
  assert.match(engine,/v_wallet\.available_balance < p_amount/)
  assert.match(engine,/where id = p_request_id and payer_id = v_payer[\s\S]+for update/)
  assert.match(engine,/if v_request\.status = 'completed' then return 'completed'/)
  assert.match(engine,/where user_id = p_user and available_balance >= p_amount/)
  assert.match(sql,/v_request\.response_idempotency_key=p_idempotency_key then return v_request\.status/)
})

test('Binance capacity assignment and release are row-locked and bounded', () => {
  assert.match(engine,/capacity_limit - rw\.confirmed_amount - rw\.reserved_amount >= p_amount/)
  assert.match(engine,/for update of rw skip locked/)
  assert.match(engine,/set reserved_amount = reserved_amount \+ p_amount/)
  assert.match(engine,/reserved_amount = greatest\(0, reserved_amount - v_request\.reserved_amount\)/)
})

test('Binance approval requires independent chain recipient amount and confirmation evidence', () => {
  for (const field of ['p_transaction_success','p_recipient_matches','p_amount_matches','p_network_token_matches']) {
    assert.match(sql,new RegExp(`not coalesce\\(${field},false\\)`))
  }
  assert.match(sql,/p_chain_id is distinct from v_config\.chain_id/)
  assert.match(sql,/p_verified_receiving_address[\s\S]+v_request\.assigned_wallet_address/)
  assert.match(sql,/p_confirmation_count,0\)<v_config\.minimum_confirmations/)
})

test('FIFO counters are atomic per level and cycle and queue positions are unique', () => {
  assert.match(engine,/primary key \(level_id, championship_cycle\)/)
  assert.match(engine,/unique \(level_id, championship_cycle, level_position\)/)
  assert.match(engine,/on conflict \(level_id, championship_cycle\)[\s\S]+last_position = queue_counters\.last_position \+ 1/)
  assert.match(engine,/order by level_position[\s\S]+for update[\s\S]+limit 1/)
})

test('FIFO payout thresholds and locked payout amounts remain exact', () => {
  assert.match(engine,/v_position > 1 and mod\(v_position - 1, 10\) = 0/)
  for (const [level, payout] of [[1,20],[2,100],[3,1000],[4,10000],[5,100000]]) {
    assert.match(engine,new RegExp(`when ${level} then ${payout}::numeric`))
  }
})

test('active-slot cap and level-cycle eligibility are enforced inside the settlement transaction', () => {
  assert.match(engine,/v_waiting \+ p_slots > 10/)
  assert.match(engine,/select \* into v_profile from public\.profiles where id = p_participant for update/)
  assert.match(engine,/if p_level > v_profile\.highest_unlocked_level/)
  assert.match(engine,/p_cycle <> v_profile\.championship_cycle/)
})

test('level progression unlocks once and Level 5 completes the championship', () => {
  assert.match(engine,/highest_unlocked_level = greatest\(highest_unlocked_level, p_level \+ 1\)/)
  assert.match(engine,/if p_level < 5 then[\s\S]+else[\s\S]+championship_status = 'completed'/)
  assert.match(engine,/completed championship requires a new paid Level 1 entry for the next cycle/i)
})

test('withdrawals enforce KYC bounds funds and the locked five-percent fee', () => {
  assert.match(engine,/v_profile\.kyc_status <> 'approved'/)
  assert.match(engine,/p_gross_amount < 10 or p_gross_amount > 100/)
  assert.match(engine,/p_gross_amount \* 0\.05/)
  assert.match(engine,/p_gross_amount - v_fee/)
  assert.match(engine,/welfrise_debit_wallet\([\s\S]+withdrawal_hold/)
})

test('financial tables and internal RPCs remain unavailable for direct authenticated writes', () => {
  for (const table of ['wallet_accounts','wallet_ledger','queue_counters','participation_slots','payout_events','financial_ledger']) {
    assert.match(engine,new RegExp(`revoke insert, update, delete on public\\.${table} from authenticated`))
  }
  for (const fn of ['welfrise_credit_wallet','welfrise_debit_wallet','welfrise_complete_participation_payment']) {
    assert.match(engine,new RegExp(`revoke all on function public\\.${fn}`))
  }
  assert.match(sql,/revoke all on all functions in schema public from public,anon,authenticated/)
})

test('Migration 006 removes the unaudited administrative profile update path', () => {
  assert.ok(authorizationHardening,`${authorizationHardeningPath} is required`)
  assert.match(authorizationHardening,/drop policy if exists profiles_admin_update on public\.profiles/i)
  assert.match(authorizationHardening,/revoke update on public\.profiles from authenticated/i)
  assert.match(authorizationHardening,/grant update\s*\(\s*full_name\s*,\s*phone\s*\)\s*on public\.profiles to authenticated/is)
})

test('Migration 006 aligns database admin authorization with the admin-only application boundary', () => {
  assert.ok(authorizationHardening,`${authorizationHardeningPath} is required`)
  assert.match(authorizationHardening,/create or replace function public\.is_admin\(\)[\s\S]+role = 'admin'/i)
  assert.doesNotMatch(authorizationHardening,/role\s+in\s*\([^)]*finance[^)]*\)/i)
})

test('Migration 006 requires KYC metadata changes to pass through controlled RPCs', () => {
  assert.match(authorizationHardening,/revoke insert, update on public\.kyc_submissions from authenticated/i)
  assert.match(sql,/grant execute on function public\.submit_kyc_metadata_v2\(uuid,text,text,text\) to authenticated/i)
  assert.match(sql,/grant execute on function public\.review_kyc_submission_v2\(uuid,text,text,text\) to authenticated/i)
})

test('Migration 006 requires AAL2 for administrative private-object reads and deletes', () => {
  assert.ok(authorizationHardening,`${authorizationHardeningPath} is required`)
  for (const policy of ['welfrise_storage_read_own_or_admin','welfrise_storage_delete_own_or_admin']) {
    assert.match(authorizationHardening,new RegExp(`create policy ${policy}[\\s\\S]+auth\\.jwt\\(\\)->>'aal'[\\s\\S]+aal2`,'i'))
  }
})

test('Migration 006 makes expired Binance submission release durable and validates EVM hashes', () => {
  assert.ok(authorizationHardening,`${authorizationHardeningPath} is required`)
  assert.match(authorizationHardening,/p_tx_hash\s*!~\s*'\^0x\[0-9a-fA-F\]\{64\}\$'/)
  assert.match(authorizationHardening,/v_request\.expires_at <= now\(\)[\s\S]+return 'expired'/)
})

test('Migration 006 fails closed on inconsistent withdrawal holds and prevents payout-hash reuse', () => {
  assert.ok(authorizationHardening,`${authorizationHardeningPath} is required`)
  assert.match(authorizationHardening,/held_balance >= v_withdrawal\.gross_amount/)
  assert.match(authorizationHardening,/Withdrawal held balance is inconsistent/)
  assert.match(authorizationHardening,/unique index if not exists withdrawals_payout_tx_hash_ci_unique[\s\S]+lower\(btrim\(payout_tx_hash\)\)/i)
  assert.match(authorizationHardening,/where nullif\(btrim\(payout_tx_hash\), ''\) is not null/i)
})
