# Welfrise Migration 006 QA Closure Runbook v1.0

Prepared: 2026-07-24

Repository: `habibwahid101/welfrise-mvp`

Production: `https://welfrise-mvp.vercel.app`

Migration: `supabase/migrations/20260724_006_authorization_and_financial_integrity_hardening.sql`

## Current closure status

**STOPPED — NOT EXECUTED.**

The workstation has no Supabase CLI, Docker-compatible runtime, PostgreSQL client, Supabase/database credentials, isolated QA project, or authenticated production session. The available production browser redirects protected routes to `/login`. No password was assumed.

Consequently:

- Migrations 001–006 have not been rehearsed against a database in this closure phase.
- Database, RLS, RPC, Storage, rollback, and concurrency cases remain `BLOCKED`, not `PASS`.
- The repository currently has no `supabase/tests/database` pgTAP closure harness. A zero-file `supabase test db` run is not evidence and must not be marked `PASS`.
- Migration 006 has not been applied to production.
- The production Treasury baseline has not been queried.
- No production or QA data, wallet balance, payment, KYC record, slot, payout, or blockchain state was changed.

The matrix remains 271 total: 59 passed, 1 failed, 211 blocked, and 0 not safely testable. Source-contract checks remain separate from functional database evidence.

## Non-negotiable controls

1. Use a fresh isolated Supabase QA project containing synthetic identities and synthetic balances only.
2. Never point `supabase db reset` at a linked or production database.
3. Do not use production money, real USDT, a real payment proof, or a real production receiving wallet.
4. Do not fabricate a successful on-chain verification. Binance approval must remain unexecuted unless an independently verifiable test-chain transaction and matching test configuration are explicitly supplied.
5. Never place a database password, service-role key, access token, TOTP seed, private document URL, full wallet address, or full transaction hash in the repository, command history, screenshots, or QA report.
6. Use unique synthetic identifiers for every run. Reset the isolated QA database between destructive scenarios.
7. Production activity is limited to the duplicate-hash preflight, the approved migration application, catalog verification, and read-only Treasury verification.
8. Any unexpected row, duplicate, permission, ledger delta, or migration output is a stop condition. Do not repair production data during this runbook.

## Owner prerequisites

The authorized owner must provide or perform all of the following:

- Install and start Docker Desktop or another Docker-compatible runtime.
- Install the current Supabase CLI and record `supabase --version`; install `psql` if the concurrency driver uses PostgreSQL sessions.
- Create a new, empty, non-production Supabase project dedicated to this rehearsal.
- Add unmistakable `QA ONLY — SYNTHETIC DATA` project labeling and restrict project access to the QA operators.
- Provide the QA project reference and database password through an approved secret manager or interactive CLI prompt. Do not send credentials in chat.
- Provide a synthetic admin, participant, payer, registered referrer, and no-referrer participant. The admin must have both real AAL1 and AAL2 QA sessions.
- Provide three small synthetic private objects owned by the participant for Storage policy checks. They must contain no identity documents or personal data.
- Provide an existing production admin account capable of a current AAL2 session for the final read-only Treasury check. Do not provide its password to QA.
- Resume this QA task after the project and sessions are available so the Phase 5 cases can be implemented in a disposable pgTAP/client harness, executed, and reviewed. Do not promote a no-test `supabase test db` result.
- Designate the migration operator, verifier, rollback decision-maker, and evidence reviewer.
- Confirm production backup/PITR health and an approved maintenance/change window before production application.

## Evidence record

Create an out-of-repository evidence folder with this structure:

```text
M006-YYYYMMDD-HHMM/
  00-operator-and-versions.txt
  01-source-sha.txt
  02-production-hash-preflight-redacted.txt
  03-local-reset-and-migration-list.txt
  04-hosted-qa-migration-list.txt
  05-database-and-rls-results.txt
  06-storage-results.txt
  07-rollback-results.txt
  08-concurrency-results.txt
  09-reconciliation-results.txt
  10-production-dry-run.txt
  11-production-apply.txt
  12-production-catalog-checks.txt
  13-production-treasury-redacted.txt
  14-application-smoke.txt
```

Record timestamps in UTC, the exact repository SHA, CLI versions, project labels, case IDs, result, expected result, actual result, and redacted evidence. Never store secrets or full financial identifiers.

## Phase 1 — source and tool verification

From a clean checkout of the approved QA-closure commit:

```powershell
git status --short
git rev-parse HEAD
git log -1 --format="%H %s"
supabase --version
docker version
psql --version
npm ci
npm run verify
npm run lint
npm run typecheck
npm run test
npm run test:integration
npm run test:e2e
npm run build
```

Expected:

- The worktree is clean.
- `HEAD` is the approved closure SHA.
- Every local validation exits zero.
- The Migration 006 contract requires `lower(btrim(payout_tx_hash))`.
- No environment file, secret, generated build output, or evidence file is staged.

Stop if any command fails.

## Phase 2 — production duplicate payout-hash preflight

Run this read-only query in the authorized production SQL console **before** applying Migration 006:

```sql
begin;
set transaction read only;

with normalized as (
  select
    id,
    lower(btrim(payout_tx_hash)) as canonical_hash
  from public.withdrawals
  where nullif(btrim(payout_tx_hash), '') is not null
),
duplicates as (
  select
    canonical_hash,
    count(*) as duplicate_count,
    array_agg(id order by id) as withdrawal_ids
  from normalized
  group by canonical_hash
  having count(*) > 1
)
select
  left(canonical_hash, 10) || '…' || right(canonical_hash, 6) as masked_hash,
  duplicate_count,
  withdrawal_ids
from duplicates
order by masked_hash;

rollback;
```

**Required result: zero rows.**

Then check for non-empty historical values that are not canonical EVM hashes:

```sql
begin;
set transaction read only;

select
  id,
  status,
  left(lower(btrim(payout_tx_hash)), 10) || '…' ||
    right(lower(btrim(payout_tx_hash)), 6) as masked_hash
from public.withdrawals
where nullif(btrim(payout_tx_hash), '') is not null
  and btrim(payout_tx_hash) !~ '^0x[0-9a-fA-F]{64}$'
order by created_at, id;

rollback;
```

Unexpected malformed rows are a stop condition requiring owner review. Do not delete, rewrite, merge, or complete any withdrawal as part of QA. Store only the masked output and IDs in evidence.

## Phase 3 — migrations 001–006 on an isolated project

### 3.1 Local disposable stack

Initialize only in a disposable worktree. The repository already contains the migration files; `supabase init` adds local configuration, not a migration.

```powershell
supabase init
supabase start
supabase db reset --local
supabase migration list --local
# Run only after the Phase 5 database test files have been added.
supabase test db
```

Expected:

- `db reset --local` recreates the local database and applies 001, 002, 003, 004, 005, and 006 in order.
- All six migrations appear in local migration history.
- Re-running `supabase db reset --local` succeeds from a clean state.
- Every Phase 5 database test file is discovered, runs inside a transaction, and finishes with rollback. A zero-file result is a stop condition.

### 3.2 Fresh hosted QA project

Link only to the clearly labeled QA project:

```powershell
supabase link --project-ref <QA_PROJECT_REF>
supabase migration list --linked
supabase db push --linked --dry-run
supabase db push --linked
supabase migration list --linked
```

Expected:

- The dry run lists exactly migrations 001–006 for an empty project.
- The apply succeeds without manual schema edits.
- The linked migration history shows all six migrations exactly once.
- A second `supabase db push --linked --dry-run` reports no pending migration.

Never run `supabase db reset --linked`.

## Phase 4 — synthetic fixture manifest

Create synthetic users through the QA project’s Auth administration flow, then seed only the linked QA project:

| Fixture | Required state |
|---|---|
| `qa_admin` | `profiles.role = 'admin'`; one AAL1 session and one AAL2 session |
| `qa_non_admin` | active participant, AAL1 |
| `qa_participant_ref` | active, `referred_by = qa_referrer` |
| `qa_participant_no_ref` | active, no valid registered referrer |
| `qa_payer` | active, synthetic available wallet balance sufficient for cases |
| `qa_referrer` | active, zero starting wallet balance |
| `qa_kyc_participant` | synthetic pending KYC row and synthetic Storage objects |
| `qa_fifo_01` … `qa_fifo_21` | active, eligible Level 1 profiles with unique request IDs |
| receiving wallet A | dummy BEP20-format address, active, capacity 100, priority 1 |
| receiving wallet B | different dummy BEP20-format address, active, capacity 100, priority 2 |

Capture the starting row counts and sums for `wallet_accounts`, `wallet_ledger`, `financial_ledger`, `participation_slots`, `payout_events`, `withdrawals`, `binance_payment_requests`, `wallet_payment_requests`, and `admin_audit_log`.

Do not use a production email, wallet address, document, transaction hash, or referral identity.

## Phase 5 — execution checklist

Use authenticated Supabase clients for RLS/RPC/Storage cases. Use privileged SQL only for fixture setup, catalog inspection, deliberate rollback injection, and reconciliation. Use a new idempotency key for a new logical action and the same key for a retry of that action.

For SQL-level RLS checks, set the claims and role inside a transaction:

```sql
begin;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '<SYNTHETIC_USER_UUID>',
    'role', 'authenticated',
    'aal', 'aal1'
  )::text,
  true
);
set local role authenticated;
-- Execute exactly one test action and its assertions.
rollback;
```

Change only the synthetic UUID and `aal` value required by the case.

### Authorization, RLS, RPC, and Storage

| Case | Action | Required functional result |
|---|---|---|
| AUTH-01 | Invoke every admin v2 mutation as `qa_non_admin`, AAL2 claim included | Every call is rejected; no target row, ledger row, audit row, or balance changes. |
| AUTH-02 | Invoke an admin v2 mutation as `qa_admin` at AAL1 | Rejected with the safe MFA requirement; no mutation. |
| AUTH-03 | Invoke an allowed admin v2 test mutation as `qa_admin` at AAL2 | Allowed once, audited once, and same-key retry has no second effect. |
| PROFILE-01 | Directly update `role`, `kyc_status`, championship fields, referral ownership, or account state as the owner | Rejected. |
| PROFILE-02 | Update only the owner’s `full_name` and `phone` | Allowed; no other profile field changes. |
| KYC-01 | Direct INSERT or UPDATE on `kyc_submissions` as authenticated | Rejected. |
| KYC-02 | Submit owner-bound synthetic paths through `submit_kyc_metadata_v2` | Allowed once; another user’s path is rejected. |
| STORAGE-01 | Owner reads own synthetic private object | Allowed. |
| STORAGE-02 | Non-owner participant reads or deletes it | Rejected. |
| STORAGE-03 | Admin AAL1 reads or deletes another user’s object | Rejected. |
| STORAGE-04 | Admin AAL2 reads another user’s object | Allowed. Delete only a disposable copy created for this case. |
| RPC-01 | Authenticated role calls internal wallet, settlement, financial, slot, or ledger functions directly | Execution is denied and state is unchanged. |

Evidence must include the HTTP/PostgREST result, role/AAL, before/after row counts, and redacted object path. Source policy text is not functional evidence.

### Binance reservation, expiry, duplicate, and rejection

| Case | Action | Required functional result |
|---|---|---|
| BIN-01 | Create a valid synthetic request | The priority-1 eligible wallet is assigned internally and reservation increases by the exact request amount. |
| BIN-02 | Fill/pause/disable wallet A, then create requests | Assignment respects capacity and status without exposing selection data to participants; no capacity is exceeded. |
| BIN-03 | Force the synthetic request expiry time into the past, then submit | RPC returns `expired`; request becomes expired; reserved amount becomes zero; wallet reservation releases exactly once. |
| BIN-04 | Submit two requests with hashes differing only by case | First submission succeeds; second is rejected by canonical uniqueness; no slot/allocation exists. |
| BIN-05 | Submit a malformed hash or another user’s proof path | Rejected; request and reservation remain consistent. |
| BIN-06 | Hold then reject, and separately direct-reject, synthetic submitted requests | Reservation releases exactly once; no confirmed amount, slot, commission, charity, or financial allocation is created. |
| BIN-07 | Attempt approval with incomplete/false verification fields | Rejected; no state or financial effect. Do not mark an approval case passed without a legitimate independently verifiable test-chain transaction. |

### User Wallet concurrency and idempotency

1. Give `qa_payer` a synthetic starting available balance.
2. Create one owner-authorization request for `qa_participant_ref`.
3. From two independent authenticated payer clients, release simultaneous calls to `respond_user_wallet_payment_request_v2` for the same request and same idempotency key.
4. Repeat with different idempotency keys against another request.

Required result for each request:

- One terminal authorization result.
- One wallet debit of the exact payment amount.
- No negative available or held balance.
- Exactly the purchased number of slots.
- Exactly one set of financial allocations per slot.
- Exactly one referral credit per slot to the participant’s registered active referrer.
- No duplicate notification, payout, ledger, commission, charity, or audit effect.
- A same-key retry returns the original result.

Also execute decline, participant cancellation, expiry, and insufficient-balance cases; all must create zero slots and zero financial allocations.

### FIFO, slot cap, referral, payout, and championship

Run each group after an isolated reset or inside a rollback-capable fixture:

| Case | Synthetic sequence | Required functional result |
|---|---|---|
| FIFO-01 | Insert approved Level 1 positions 1–10 | Positions are unique and ordered; no payout occurs. |
| FIFO-02 | Insert position 11 | Exactly the earliest waiting slot completes; one $20 Level 1 payout event is created. |
| FIFO-03 | Continue positions 12–20 | No additional payout; queue order remains unchanged. |
| FIFO-04 | Insert position 21 | Exactly the next earliest waiting slot completes; exactly one additional $20 payout event is created. |
| FIFO-05 | Concurrently create positions around a threshold | No duplicate position, skipped counter value caused by a committed race, reordered winner, or duplicate payout. |
| CAP-01 | Give one participant 10 active waiting slots at one level/cycle, then request one more | The 11th active waiting slot is rejected and all state rolls back. |
| REF-01 | Approve one $10 slot for `qa_participant_ref` | $1 standard charity, $1 registered-referrer commission, $4.50 reserve, and $3.50 operations; total $10. |
| REF-02 | Approve one $10 slot for `qa_participant_no_ref` | $1 standard charity, $1 referral-to-charity fallback, $4.50 reserve, and $3.50 operations; total $10. |
| LEVEL-01 | Trigger the first completion at Levels 1–4 and then another completion at the same level | Next level unlocks once; later completions do not duplicate or skip an unlock. |
| LEVEL-02 | Complete Level 5 | Championship status becomes completed once and completion time is recorded. |
| LEVEL-03 | Make a new paid Level 1 entry after completion | Server derives the next cycle; new cycle becomes active; old and new queue records remain isolated. |

For the forced rollback case, deliberately cause the final financial insert to violate a disposable test-only constraint or raise from a test-only trigger inside the isolated database. Confirm that the request, wallet, slots, queue counter, profile unlock, payout event, and all ledgers return to their exact before-state. Remove the test-only trigger by resetting the QA database; never add it to a migration.

### Withdrawal and payout-hash integrity

| Case | Action | Required functional result |
|---|---|---|
| WDR-01 | Request $10 with approved KYC and sufficient synthetic balance | $10 moves from available to held; fee is $0.50; net is $9.50. |
| WDR-02 | Hold then reject | Hold changes no balance; rejection returns exactly $10 to available, clears the corresponding held amount, and writes one release ledger entry. |
| WDR-03 | Approve then complete with a synthetic valid-format hash | Held decreases exactly $10; withdrawal becomes completed; gross $10, fee $0.50, and net $9.50 are recorded separately. No chain transfer is represented by this synthetic database test. |
| WDR-04 | Complete a second withdrawal with the same hash padded with spaces and different case | Rejected by `lower(btrim(payout_tx_hash))` uniqueness; held balance and both withdrawals remain transactionally consistent. |
| WDR-05 | Simultaneously review the same withdrawal | One terminal effect; no double release, double completion, negative held balance, or duplicate ledger. |
| WDR-06 | Corrupt only the isolated fixture so held balance is below gross, then reject/complete | Function fails closed with no withdrawal or ledger mutation. |

Never label a synthetic payout hash as a real blockchain payout. It proves database uniqueness and transaction behavior only.

## Phase 6 — exact reconciliation queries

After each approved synthetic $10 slot, run:

```sql
select
  reference_id,
  sum(amount) filter (where entry_type = 'participation_contribution') as receipts,
  sum(amount) filter (where entry_type = 'charity_allocation') as standard_charity,
  sum(amount) filter (where entry_type = 'referral_commission') as referral,
  sum(amount) filter (where entry_type = 'referral_to_charity') as referral_fallback,
  sum(amount) filter (where entry_type = 'level_bonus_reserve') as reserve,
  sum(amount) filter (where entry_type = 'platform_operations_reserve') as operations
from public.financial_ledger
where reference_id = '<SYNTHETIC_REQUEST_UUID>'
group by reference_id;
```

Required per slot:

- receipts = 10
- standard charity = 1
- referral + referral fallback = 1
- reserve = 4.50
- operations = 3.50
- allocations total = 10

Run the Treasury view as the synthetic AAL2 admin:

```sql
begin;
set transaction read only;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '<QA_ADMIN_UUID>',
    'role', 'authenticated',
    'aal', 'aal2'
  )::text,
  true
);
set local role authenticated;
select * from public.admin_treasury_exposure;
rollback;
```

Reconcile the view to independent base-table aggregates and require a zero unexplained difference for receipts, charity, referral, reserve, operations, available liabilities, held liabilities, completed payouts, waiting slots, and nominal exposure.

## Phase 7 — rehearsal acceptance gate

Production application is authorized only when:

- Migrations 001–006 apply cleanly to both a reset local stack and the fresh hosted QA project.
- Every case above has functional evidence and the relevant blocked matrix rows are individually reclassified.
- All concurrency cases were released from independent sessions, not sequentially simulated.
- Rollback cases show exact before/after equality.
- Production duplicate and malformed payout-hash preflights return zero rows.
- All local application suites pass.
- No Critical or High functional failure remains.
- The migration operator and independent reviewer sign the evidence record.

If any item is missing, the result is `NO-GO`; do not apply Migration 006 to production.

## Phase 8 — exact production application

From the clean approved closure SHA:

```powershell
git status --short
git rev-parse HEAD
supabase link --project-ref <PRODUCTION_PROJECT_REF>
supabase migration list --linked
supabase db push --linked --dry-run
```

The independent reviewer must confirm the dry run lists **only** `20260724_006_authorization_and_financial_integrity_hardening.sql`. If it lists any other migration or schema action, stop.

During the approved change window:

```powershell
supabase db push --linked
supabase migration list --linked
supabase db push --linked --dry-run
```

Required:

- Migration 006 applies once.
- Migration history shows 001–006 in order.
- The final dry run reports no pending migrations.
- No manual production data update is performed.

## Phase 9 — production post-migration verification

Run these read-only catalog checks:

```sql
begin;
set transaction read only;

select
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and indexname = 'withdrawals_payout_tx_hash_ci_unique';

select
  has_table_privilege('authenticated', 'public.profiles', 'UPDATE') as broad_profile_update,
  has_column_privilege('authenticated', 'public.profiles', 'full_name', 'UPDATE') as full_name_update,
  has_column_privilege('authenticated', 'public.profiles', 'phone', 'UPDATE') as phone_update,
  has_table_privilege('authenticated', 'public.kyc_submissions', 'INSERT') as direct_kyc_insert,
  has_table_privilege('authenticated', 'public.kyc_submissions', 'UPDATE') as direct_kyc_update;

select
  policyname,
  cmd,
  roles,
  qual
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and policyname in (
    'welfrise_storage_read_own_or_admin',
    'welfrise_storage_delete_own_or_admin'
  )
order by policyname;

select
  id,
  file_size_limit
from storage.buckets
where id = 'welfrise-private';

rollback;
```

Required:

- The unique index expression is `lower(btrim(payout_tx_hash))`.
- Broad authenticated profile update is false; `full_name` and `phone` column updates are true.
- Direct authenticated KYC insert/update is false.
- Both private-object policies contain admin plus AAL2 enforcement while retaining owner access.
- The private bucket limit is 4,000,000 bytes.

Repeat AUTH-01, AUTH-02, PROFILE-01, KYC-01, STORAGE-02, and STORAGE-03 with non-mutating or disposable production-safe probes only if explicitly approved. Do not upload a real KYC document or run a financial mutation.

## Phase 10 — production Treasury baseline

Use a current authenticated production admin AAL2 session and read `admin_treasury_exposure`. If the SQL console is used, impersonate only the known admin UUID inside a read-only transaction:

```sql
begin;
set transaction read only;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '<AUTHORIZED_PRODUCTION_ADMIN_UUID>',
    'role', 'authenticated',
    'aal', 'aal2'
  )::text,
  true
);
set local role authenticated;

select
  total_confirmed_participation_receipts,
  charity_allocations,
  referral_commissions,
  level_bonus_reserve_allocations,
  operations_allocations,
  available_wallet_liabilities,
  coalesce(
    (waiting_slot_exposure_by_level -> '1' ->> 'waiting_slots')::integer,
    0
  ) as level_1_waiting_slots,
  coalesce(
    (waiting_slot_exposure_by_level -> '1' ->> 'nominal_payout_exposure')::numeric,
    0
  ) as level_1_nominal_payout_exposure
from public.admin_treasury_exposure;

rollback;
```

Required unchanged baseline:

| Measure | Expected |
|---|---:|
| Confirmed participation receipts | $20 |
| Charity allocations | $3 |
| Referral commissions | $1 |
| Level Bonus Reserve allocations | $9 |
| Operations allocations | $7 |
| Available-wallet liabilities | $1 |
| Level 1 waiting slots | 2 |
| Level 1 nominal payout exposure | $40 |

Zero rows, more than one row, any mismatch, or an admin warning is a stop condition. Do not “correct” a mismatch during QA. Capture the redacted result and escalate it to the owner for reconciliation.

## Phase 11 — application smoke and closure decision

After the production deployment containing the approved migration:

1. Verify `/api/health` returns HTTP 200 and no sensitive detail.
2. Verify anonymous protected routes still redirect to `/login`.
3. Verify an existing participant can read `/app`, Payments, KYC, and Security without mutation.
4. Verify a production admin at AAL1 sees the intended read-only boundary.
5. Verify the same admin at AAL2 can read the admin page and Treasury view.
6. Verify no console-breaking error and no unexpected Supabase/Vercel error.
7. Confirm Vercel serves the approved source SHA.

Only after all evidence is reviewed may the closed-pilot result change from `NO-GO` to `GO WITH CONDITIONS`. Public real-money launch remains `NO-GO` until legal, independent security, treasury funding, payout sustainability, operational readiness, and all Critical/High requirements are independently resolved.

## References

- Supabase local development and CLI: `https://supabase.com/docs/guides/local-development`
- Supabase CLI workflow and explicit local/linked targeting: `https://supabase.com/docs/guides/local-development/cli-workflows`
- Supabase database testing with pgTAP and transaction rollback: `https://supabase.com/docs/guides/database/testing`
- Supabase RLS and MFA `aal` claims: `https://supabase.com/docs/guides/auth/auth-mfa`
