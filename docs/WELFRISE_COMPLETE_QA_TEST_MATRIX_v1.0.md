# Welfrise Complete QA Test Matrix v1.0

Prepared: 2026-07-24
Repository baseline: `484f12e1b4f6751932dc36ab28bd0edac2d8221e` (`main`, synchronized with `origin/main`)
Production target: `https://welfrise-mvp.vercel.app`
Release boundary: invitation-only closed pilot; public real-money launch remains unauthorized.

## Evidence and safety rules

- `AUTO` means an executable local test with deterministic assertions.
- `CONTRACT` means source, migration, generated-route, or configuration inspection. It does not prove live database behavior.
- `DB-ISO` means a disposable Supabase/PostgreSQL fixture with transaction rollback is required. It must never point at production.
- `PROD-RO` means an unauthenticated or existing-session production read that does not mutate data.
- `SESSION` means an existing authorized session and supplied credentials are required; no password is assumed.
- `UNSAFE` means the scenario is not executed against production because it would alter money, KYC, wallet, invitation, slot, payout, or blockchain state.
- A test is not a PASS until its evidence is recorded in the functional regression report. Source-contract coverage and live execution are counted separately.
- Full wallet addresses, transaction hashes, private document URLs, tokens, passwords, and secrets must be redacted from all evidence.

## A. Repository, build, and deployment quality

| ID | Test | Method | Environment | Expected result |
|---|---|---|---|---|
| A-001 | Clean install from committed lockfile | AUTO | Local clean dependency tree | `npm ci` succeeds without lockfile drift. |
| A-002 | Lockfile syntax and completeness | AUTO | Local | JSON parses, lockfile v3 root metadata matches `package.json`, and npm resolves the tree. |
| A-003 | Dependency vulnerability audit | AUTO | Local/registry | No known production vulnerability requiring an in-scope upgrade. |
| A-004 | MVP invariant verification | AUTO | Local | All verification assertions pass. |
| A-005 | ESLint | AUTO | Local | No lint errors or warnings indicating production risk. |
| A-006 | TypeScript strict check | AUTO | Local | `tsc --noEmit` passes. |
| A-007 | Unit suite | AUTO | Local | All unit tests pass. |
| A-008 | Migration/security contract suite | AUTO | Local | All contract tests pass. |
| A-009 | Route/component regression suite | AUTO | Local | All route tests pass. |
| A-010 | Production build | AUTO | Local | Next.js production build completes. |
| A-011 | Invalid top-level `use server` exports | AUTO + CONTRACT | Local | Every runtime export in such files is async. |
| A-012 | Server/client component boundaries | CONTRACT | Local | No server-only API is imported into a client bundle and no invalid boundary is found. |
| A-013 | Broken or unused imports | AUTO + CONTRACT | Local | Typecheck/lint/build expose none. |
| A-014 | Environment validation | CONTRACT + PROD-RO | Local/production | Only required public Supabase variables are referenced; missing config fails safely. |
| A-015 | Secret scan | CONTRACT | Tracked repository | No service-role key, password, token, private key, or committed environment file. |
| A-016 | Security headers | PROD-RO | Production | CSP, HSTS, frame denial, MIME protection, referrer policy, permissions policy, and noindex are present. |
| A-017 | Vercel framework/output compatibility | CONTRACT + PROD-RO | Local/production | Next.js framework is detected and no forced static output directory breaks deployment. |
| A-018 | Health endpoint | PROD-RO | Production | `/api/health` returns 200 and the fixed public health payload. |
| A-019 | Safe production errors | CONTRACT + PROD-RO | Local/production | Errors omit stack traces, SQL details, secrets, and raw provider errors. |
| A-020 | Repository/production version alignment | CONTRACT + PROD-RO | Git/Vercel | Production deployment resolves to the final pushed commit. |

## B. Authentication and account security

| ID | Test | Method | Environment | Expected result |
|---|---|---|---|---|
| B-001 | Invitation required | CONTRACT + DB-ISO | Migration/disposable DB | Uninvited signup is rejected. |
| B-002 | Valid invitation | DB-ISO | Disposable Auth/DB | One eligible account is created and invitation is consumed. |
| B-003 | Invalid invitation | DB-ISO | Disposable Auth/DB | Signup fails with neutral pilot messaging. |
| B-004 | Expired invitation | DB-ISO | Disposable Auth/DB | Signup fails and no profile is created. |
| B-005 | Used invitation | DB-ISO | Disposable Auth/DB | Reuse fails. |
| B-006 | Revoked invitation | DB-ISO | Disposable Auth/DB | Signup fails. |
| B-007 | Email-restricted invitation | DB-ISO | Disposable Auth/DB | Only the case-insensitive invited email can consume it. |
| B-008 | Concurrent invitation use | DB-ISO | Disposable Auth/DB | Row locking permits at most one consumer. |
| B-009 | Registration with valid referral | DB-ISO | Disposable Auth/DB | Immutable `referred_by` resolves to the registered referrer. |
| B-010 | Registration without referral | DB-ISO | Disposable Auth/DB | Account is created with no referrer. |
| B-011 | Invalid referral | DB-ISO | Disposable Auth/DB | Account can be created, but no invalid commission recipient is recorded. |
| B-012 | Plus-address identity | SESSION | QA account | Full alias remains the distinct login/profile identity. |
| B-013 | Email confirmation callback | CONTRACT + SESSION | Local/production | PKCE code exchanges and redirects only to a safe local path. |
| B-014 | Open redirect rejection | AUTO + CONTRACT | Local | Absolute or protocol-relative `next` values fall back to `/app`. |
| B-015 | Valid login | SESSION | Production | Correct credentials create a session and open `/app`. |
| B-016 | Invalid login | PROD-RO | Production | Neutral error is shown without account enumeration. |
| B-017 | Login rate limit | DB-ISO | Disposable DB | Limit is enforced per actor/window. |
| B-018 | Logout | SESSION | Production | Session is revoked and user returns to `/login`. |
| B-019 | Session persistence | SESSION | Production | Reload retains an unexpired authenticated session. |
| B-020 | Session expiry | SESSION | Isolated/local | Protected routes return to login without leaking data. |
| B-021 | Unauthenticated route protection | PROD-RO | Production | `/app`, payments, KYC, security, and admin do not expose private content. |
| B-022 | Normal-user admin redirect | SESSION | Production | Participant cannot render `/admin`. |
| B-023 | Cross-account session isolation | DB-ISO + SESSION | Disposable DB/QA sessions | A user cannot read or mutate another user’s private rows. |
| B-024 | Password-recovery target | AUTO + CONTRACT | Local | Redirect target is the public `/reset-password` route. |
| B-025 | Recovery anti-enumeration | AUTO + PROD-RO | Local/production | The same neutral response is shown regardless of account existence. |
| B-026 | Recovery request abuse protection | CONTRACT + SESSION | Supabase/project config | Effective rate limit is evidenced without revealing account existence. |
| B-027 | PKCE `PASSWORD_RECOVERY` session | AUTO + SESSION | Local/QA link | Valid recovery event unlocks the password form. |
| B-028 | Missing recovery link | AUTO + PROD-RO | Local/production | Fixed inline missing-link error. |
| B-029 | Expired/reused/invalid recovery link | AUTO + SESSION | Isolated/QA link | Fixed inline invalid-link error; no provider detail. |
| B-030 | Recovery password minimum | AUTO | Local | Password shorter than 12 characters is rejected inline. |
| B-031 | Recovery password mismatch | AUTO | Local | Mismatch is rejected before `updateUser`. |
| B-032 | Successful password update | AUTO + SESSION | Harness/QA account | `updateUser` succeeds, local session signs out, and login link is available. |
| B-033 | Recovery token removal | AUTO | Local | Query/hash recovery credentials are removed with `history.replaceState`. |
| B-034 | Direct profile identity mutation | CONTRACT + DB-ISO | Migration/disposable DB | A participant cannot change security-managed email, role, referrer, KYC, level, or cycle fields directly. |

## C. Admin MFA and authorization

| ID | Test | Method | Environment | Expected result |
|---|---|---|---|---|
| C-001 | Admin route role gate | CONTRACT + SESSION | Local/production | Only an authorized administrative role reaches the page. |
| C-002 | AAL1 read-only page | CONTRACT + SESSION | Production | Data may render, but every mutation control is disabled. |
| C-003 | AAL1 direct financial RPC denial | CONTRACT + DB-ISO | Disposable DB | Database rejects wallet, Binance, and withdrawal mutations without AAL2. |
| C-004 | AAL1 direct KYC mutation denial | CONTRACT + DB-ISO | Disposable DB | KYC review RPC and any alternative write path fail. |
| C-005 | AAL2 allowed mutation | DB-ISO + SESSION | Disposable DB/QA session | Authorized actions work after MFA. |
| C-006 | Normal-user RPC denial | DB-ISO | Disposable DB | Every admin wrapper rejects a participant. |
| C-007 | Self-promotion denial | CONTRACT + DB-ISO | Migration/disposable DB | User cannot set an administrative role. |
| C-008 | Direct admin profile-write bypass | CONTRACT + DB-ISO | Migration/disposable DB | No unaudited AAL1 path can change another profile’s managed fields. |
| C-009 | Admin audit trail | CONTRACT + DB-ISO | Disposable DB | Authorized mutations create immutable audit records. |
| C-010 | Audit immutability | CONTRACT + DB-ISO | Disposable DB | Authenticated users cannot update/delete history. |
| C-011 | Sensitive-value masking | CONTRACT + SESSION | Local/production | Wallet addresses and hashes are masked by default. |
| C-012 | Private document/proof read step-up | CONTRACT + DB-ISO | Storage policies/disposable DB | Admin AAL1 cannot fetch private evidence; AAL2 can. |
| C-013 | Private document/proof delete step-up | CONTRACT + DB-ISO | Storage policies/disposable DB | Admin AAL1 cannot delete another user’s private objects. |
| C-014 | Server Action exports | AUTO | Local | Admin action module imports and exports only async runtime functions. |
| C-015 | Inline expected action errors | AUTO | Local harness | Expected action failures stay in the affected row, not a full-page error. |
| C-016 | Rapid duplicate admin submit | AUTO + DB-ISO | Local/disposable DB | Client pending guard and database idempotency prevent repeated effects. |

## D. KYC workflow

| ID | Test | Method | Environment | Expected result |
|---|---|---|---|---|
| D-001 | Not-submitted state | CONTRACT + SESSION | Local/production | Readable status and submission form are shown. |
| D-002 | Initial submission | AUTO + DB-ISO | Harness/disposable storage | Three owned private paths and one pending metadata row are created. |
| D-003 | Upload progress | AUTO + SESSION | Local/QA | Accessible preparation, upload percentage, and saving stages display. |
| D-004 | Empty upload | AUTO | Local/harness | Required-file error is inline and no upload starts. |
| D-005 | Unsupported MIME | AUTO | Local/harness | Rejected client- and server-side. |
| D-006 | Spoofed MIME/signature | AUTO | Local/harness | Magic-byte mismatch is rejected. |
| D-007 | Oversized file | AUTO | Local/harness | File over 5 MB is rejected. |
| D-008 | Duplicate pending submission | DB-ISO | Disposable DB | Second active submission is rejected. |
| D-009 | Pending state | CONTRACT + DB-ISO | Local/disposable DB | Replacement is disabled while review is active. |
| D-010 | Held review | AUTO + DB-ISO | Harness/disposable DB | Status becomes held/Under review with audit record. |
| D-011 | Approved review | AUTO + DB-ISO | Harness/disposable DB | Submission and profile status become approved. |
| D-012 | Rejected review note | AUTO + DB-ISO | Harness/disposable DB | Rejected status and safe review note are visible. |
| D-013 | Re-upload after rejection | DB-ISO | Disposable storage/DB | New paths replace metadata; old files are cleaned only after success. |
| D-014 | Upload failure cleanup | AUTO + DB-ISO | Harness/disposable storage | Newly uploaded files are removed if later upload/RPC fails. |
| D-015 | Old-file cleanup failure | CONTRACT + DB-ISO | Disposable storage | Successful resubmission remains consistent; cleanup failure is observable. |
| D-016 | Another user’s KYC row | DB-ISO | Disposable DB | RLS denies access. |
| D-017 | Another user’s KYC object | DB-ISO | Disposable storage | Storage RLS denies access. |
| D-018 | Signed URL expiry | SESSION | QA session | Private URL expires after five minutes. |
| D-019 | KYC gate for withdrawal | DB-ISO | Disposable DB | Non-approved profile cannot withdraw. |
| D-020 | Admin MFA review gate | DB-ISO | Disposable DB | AAL1 review fails; AAL2 review succeeds. |
| D-021 | Refresh/retry recovery | SESSION | Local/QA | Refresh reflects saved state and does not duplicate uploads. |
| D-022 | No Server Action page crash | AUTO | Local harness | Reject, held, and approve rerender normally. |

## E. User Wallet payment workflow

| ID | Test | Method | Environment | Expected result |
|---|---|---|---|---|
| E-001 | Create authorization request | AUTO + DB-ISO | Harness/disposable DB | Correct participant/payer request is pending. |
| E-002 | Wallet-owner resolution by UUID | DB-ISO | Disposable DB | Exact active owner is selected. |
| E-003 | Wallet-owner resolution by referral code | DB-ISO | Disposable DB | Exact active owner is selected. |
| E-004 | Wallet-owner resolution by full email/plus alias | DB-ISO | Disposable DB | Complete case-insensitive identity selects one unambiguous owner. |
| E-005 | Self-payment rejection | DB-ISO | Disposable DB | Participant cannot select self as payer. |
| E-006 | Valid levels | AUTO + DB-ISO | Harness/disposable DB | Only server-eligible unlocked levels are accepted. |
| E-007 | Valid slot counts | AUTO + DB-ISO | Local/disposable DB | Only 1, 2, 5, and 10 are accepted. |
| E-008 | Server-derived amount | AUTO + DB-ISO | Local/disposable DB | Amount always equals slots × $10. |
| E-009 | Client amount tampering | AUTO | Route harness | Tampered explicit amount is rejected before RPC. |
| E-010 | Level/cycle tampering | CONTRACT + DB-ISO | Disposable DB | Cycle is server-derived and locked-level requests fail. |
| E-011 | Insufficient payer balance at creation | DB-ISO | Disposable DB | Request is rejected without financial effect. |
| E-012 | Insufficient payer balance at approval | DB-ISO | Disposable DB | Atomic approval fails with no debit/slot/allocation. |
| E-013 | Approval | DB-ISO | Disposable DB | Owner debit, participant slots, ledger, allocations, and notifications commit atomically. |
| E-014 | Decline | DB-ISO | Disposable DB | Status changes with no financial/slot effect. |
| E-015 | Participant cancellation | DB-ISO | Disposable DB | Pending request cancels with no debit. |
| E-016 | Cancellation after approval | DB-ISO | Disposable DB | Rejected; completed effects remain unchanged. |
| E-017 | Duplicate click | AUTO + DB-ISO | Local/disposable DB | Synchronous guard and idempotency prevent duplicates. |
| E-018 | Repeated creation key | DB-ISO | Disposable DB | Same key returns one request. |
| E-019 | Concurrent approval | DB-ISO | Disposable DB | Row lock permits one settlement. |
| E-020 | Correct available/held balances | DB-ISO | Disposable DB | Approval debits available only; no unauthorized held movement. |
| E-021 | Slots only after approval | DB-ISO | Disposable DB | Pending/declined/cancelled/expired requests create zero slots. |
| E-022 | Referral follows participant | DB-ISO | Disposable DB | Payer identity cannot redirect commission. |
| E-023 | Charity fallback | DB-ISO | Disposable DB | Invalid/missing registered referrer sends exactly $1/slot to charity. |
| E-024 | No duplicate side effects | DB-ISO | Disposable DB | Request, slots, wallet ledger, financial ledger, commission, charity, and notices remain singular. |

## F. Binance/BEP20 payment workflow

| ID | Test | Method | Environment | Expected result |
|---|---|---|---|---|
| F-001 | Receiving-wallet creation | DB-ISO | Disposable DB | Valid internal wallet is created only by AAL2 admin. |
| F-002 | BEP20 validation | AUTO + DB-ISO | Local/disposable DB | Only `0x` plus 40 hex characters is accepted. |
| F-003 | Case-insensitive duplicate wallet | DB-ISO | Disposable DB | Unique constraint rejects duplicate address/network casing. |
| F-004 | Capacity/priority selection | DB-ISO | Disposable DB | First eligible active wallet by priority/order is locked and selected. |
| F-005 | Paused/disabled/capacity-reached exclusion | DB-ISO | Disposable DB | Ineligible wallets are never assigned. |
| F-006 | Capacity reservation | DB-ISO | Disposable DB | Exact request amount is reserved atomically. |
| F-007 | Concurrent reservation | DB-ISO | Disposable DB | `FOR UPDATE SKIP LOCKED` prevents over-allocation. |
| F-008 | Public response minimization | AUTO + CONTRACT | Local | Participant receives only one assigned address and payment fields, not internal rotation metadata. |
| F-009 | Unavailable message | AUTO + PROD-RO | Local/production | Fixed nontechnical message only. |
| F-010 | Maximum active requests | DB-ISO | Disposable DB | Sixth active request is rejected. |
| F-011 | Request expiry | DB-ISO | Disposable DB | Awaiting request becomes expired once. |
| F-012 | Expiry capacity release | DB-ISO | Disposable DB | Reservation is released exactly once and eligible wallet can reactivate. |
| F-013 | Expired proof submission | DB-ISO | Disposable DB | Expired request remains durably expired and capacity is released. |
| F-014 | Proof upload | AUTO + DB-ISO | Harness/disposable storage | Owned non-overwriting path and metadata are stored. |
| F-015 | Transaction reference validation | AUTO + DB-ISO | Local/disposable DB | Missing/oversized/malformed reference is rejected safely. |
| F-016 | Duplicate transaction hash | DB-ISO | Disposable DB | Case-insensitive reuse cannot fund another request. |
| F-017 | Proof privacy | DB-ISO | Disposable storage | Only owner or authorized AAL2 admin can read evidence. |
| F-018 | Submitted/held/reject transitions | DB-ISO | Disposable DB | Valid transitions preserve/release capacity correctly. |
| F-019 | No preapproval allocations | DB-ISO | Disposable DB | Awaiting/submitted/held/rejected/expired create no slots or financial allocations. |
| F-020 | Screenshot-only approval denial | DB-ISO | Disposable DB | Proof file alone cannot approve. |
| F-021 | Verification configuration required | DB-ISO | Disposable DB | Enabled chain, token contract, and confirmations are mandatory. |
| F-022 | Chain/token/recipient/amount/status/confirmation checks | DB-ISO | Disposable DB | Any mismatch or missing evidence rejects approval atomically. |
| F-023 | Verification block/source persistence | DB-ISO | Disposable DB | Block, count, method, source, and verified time are recorded. |
| F-024 | Safe rejection without fake verification | DB-ISO | Disposable DB | Admin can reject without fabricated chain fields. |
| F-025 | Transaction reuse after rejection | DB-ISO | Disposable DB | Submitted hash remains non-reusable. |
| F-026 | Duplicate approval idempotency | DB-ISO | Disposable DB | One receipt/slot/allocation set only. |

## G. Financial ledger and treasury integrity

| ID | Test | Method | Environment | Expected result |
|---|---|---|---|---|
| G-001 | Per-slot allocation sum | AUTO + DB-ISO | Local/disposable DB | $1 charity + $1 referral/fallback + $4.50 reserve + $3.50 operations = $10. |
| G-002 | One-slot allocation | DB-ISO | Disposable DB | One exact allocation set. |
| G-003 | Multi-slot allocation | DB-ISO | Disposable DB | Independent exact allocation set per slot. |
| G-004 | Decimal precision | AUTO + DB-ISO | Local/disposable DB | Cents are exact with no floating/rounding drift. |
| G-005 | Valid referrer allocation | DB-ISO | Disposable DB | $1/slot wallet and financial credits agree. |
| G-006 | Charity fallback allocation | DB-ISO | Disposable DB | Total charity is $2/slot when referrer is invalid/missing. |
| G-007 | Duplicate approval protection | DB-ISO | Disposable DB | No duplicate receipt/allocation/commission. |
| G-008 | Partial-failure rollback | DB-ISO | Disposable DB | Debit, slots, allocations, payout, unlock, and status all roll back together. |
| G-009 | Wallet ledger/balance reconciliation | DB-ISO | Disposable DB | Ledger-derived balance equals account balance. |
| G-010 | Treasury receipt reconciliation | CONTRACT + DB-ISO | Disposable DB | Approved participation receipts equal approved slot totals. |
| G-011 | Treasury allocation reconciliation | CONTRACT + DB-ISO | Disposable DB | Charity/referral/reserve/operations totals match slot formula. |
| G-012 | Liability reconciliation | CONTRACT + DB-ISO | Disposable DB | Available, held, completed-payout, and waiting exposure totals are explainable. |
| G-013 | Non-final status invariance | DB-ISO | Disposable DB | Pending/held/rejected/cancelled/expired create no participation allocations. |
| G-014 | Baseline read-only verification | SESSION + PROD-RO | Production admin | Baseline remains receipts $20, charity $3, referral $1, reserve $9, operations $7, available $1, L1 waiting 2, nominal exposure $40. |
| G-015 | Reconciliation difference | DB-ISO + SESSION | Disposable/production read-only | Query reports zero unexplained difference. |

## H. FIFO, slots, payouts, and progression

| ID | Test | Method | Environment | Expected result |
|---|---|---|---|---|
| H-001 | First FIFO position | DB-ISO | Disposable DB | First slot is position 1. |
| H-002 | Unique positions | CONTRACT + DB-ISO | Migration/disposable DB | `(level, cycle, position)` cannot duplicate. |
| H-003 | No admin reorder | CONTRACT + DB-ISO | Migration/disposable DB | No exposed update path can edit positions. |
| H-004 | Per-level queues | DB-ISO | Disposable DB | Positions are independent by level. |
| H-005 | Per-cycle queues | DB-ISO | Disposable DB | Positions are independent by championship cycle. |
| H-006 | Multi-slot independent rows | DB-ISO | Disposable DB | Package creates exactly 1/2/5/10 slot rows. |
| H-007 | Active-slot cap | AUTO + DB-ISO | Local/disposable DB | More than 10 waiting slots per participant/level/cycle is rejected. |
| H-008 | FIFO positions 1–11 | AUTO + DB-ISO | Local/disposable DB | Position 11 completes earliest waiting slot only. |
| H-009 | FIFO positions 12–21 | AUTO + DB-ISO | Local/disposable DB | Position 21 completes next earliest waiting slot only. |
| H-010 | Payout by level | AUTO + DB-ISO | Local/disposable DB | Payouts are $20/$100/$1,000/$10,000/$100,000. |
| H-011 | No premature payout | DB-ISO | Disposable DB | Positions other than 11/21/31… do not complete a slot. |
| H-012 | Concurrent FIFO insertion | DB-ISO | Disposable DB | Counter locking yields unique monotonic positions. |
| H-013 | Slot/payout consistency | DB-ISO | Disposable DB | Completed slot, payout event, wallet credit, and ledger agree. |
| H-014 | Next-level unlock once | DB-ISO | Disposable DB | First completion raises highest unlocked level once. |
| H-015 | Duplicate unlock prevention | DB-ISO | Disposable DB | Later same-level completions do not duplicate progression. |
| H-016 | Locked-level denial | DB-ISO | Disposable DB | Locked participation fails before payment settlement. |
| H-017 | Level 5 championship completion | DB-ISO | Disposable DB | Status/completion timestamp update atomically. |
| H-018 | New paid Level 1 cycle | DB-ISO | Disposable DB | Next cycle begins only through approved paid Level 1. |
| H-019 | Old/new cycle isolation | DB-ISO | Disposable DB | Historical records and queue heads remain separated. |
| H-020 | Failed posting rollback | DB-ISO | Disposable DB | Failed financial post rolls back slot, payout, unlock, and cycle changes. |

## I. Withdrawal workflow

| ID | Test | Method | Environment | Expected result |
|---|---|---|---|---|
| I-001 | KYC gate | AUTO + DB-ISO | Local/disposable DB | Only approved KYC can request withdrawal. |
| I-002 | Amount range | AUTO + DB-ISO | Local/disposable DB | Gross below $10 or above $100 is rejected. |
| I-003 | Cent precision | DB-ISO | Disposable DB | Gross accepts valid cents only and derived values remain exact. |
| I-004 | BEP20 address | AUTO + DB-ISO | Local/disposable DB | Invalid address is rejected. |
| I-005 | Insufficient available balance | DB-ISO | Disposable DB | Request fails without negative or held balance. |
| I-006 | Fee/net formula | AUTO + DB-ISO | Local/disposable DB | Fee is 5%; net is 95%; gross/fee/net stored separately. |
| I-007 | Available-to-held atomic move | DB-ISO | Disposable DB | Gross leaves available and enters held in one transaction. |
| I-008 | One active request | CONTRACT + DB-ISO | Migration/disposable DB | Concurrent active requests cannot duplicate holds. |
| I-009 | Daily gross limit | DB-ISO | Disposable DB | Non-rejected daily gross cannot exceed $100. |
| I-010 | Pending/hold/approve | DB-ISO | Disposable DB | Allowed review states preserve held gross. |
| I-011 | Reject release | AUTO + DB-ISO | Local/disposable DB | Exact gross moves from held back to available once. |
| I-012 | Complete | DB-ISO | Disposable DB | Held gross clears and financial gross/fee/net records are atomic. |
| I-013 | Duplicate completion | DB-ISO | Disposable DB | Repeated review creates no duplicate ledger effect. |
| I-014 | Concurrent review | DB-ISO | Disposable DB | Row lock permits one terminal outcome. |
| I-015 | Held-balance fail-closed | DB-ISO | Disposable DB | Inconsistent held balance aborts instead of minting/releasing funds. |
| I-016 | Payout transaction reference uniqueness | CONTRACT + DB-ISO | Migration/disposable DB | One on-chain payout reference cannot complete multiple withdrawals. |
| I-017 | Admin MFA | DB-ISO | Disposable DB | AAL1 fails and AAL2 succeeds. |
| I-018 | Audit and notification | DB-ISO | Disposable DB | Review/terminal actions are auditable and user-visible. |
| I-019 | User cancellation | CONTRACT | Local/migration | Unsupported cancellation is not exposed; no invented rule is added. |
| I-020 | Client eligibility UI | AUTO + SESSION | Local/production | Button disables with one clear reason for KYC, funds, amount, address, or busy state. |

## J. Database, RPC, RLS, and storage security

| ID | Test | Method | Environment | Expected result |
|---|---|---|---|---|
| J-001 | RLS inventory | CONTRACT | Migrations | Every private/business table has RLS enabled. |
| J-002 | Own-row reads | DB-ISO | Disposable DB | Participants see only records permitted for their role/relationship. |
| J-003 | Direct balance mutation denial | CONTRACT + DB-ISO | Disposable DB | User cannot insert/update/delete wallet accounts or ledger. |
| J-004 | Direct slot mutation denial | CONTRACT + DB-ISO | Disposable DB | User cannot create/reorder/update slots. |
| J-005 | Direct financial-ledger mutation denial | CONTRACT + DB-ISO | Disposable DB | Authenticated user cannot write financial ledger. |
| J-006 | Referral ownership mutation denial | CONTRACT + DB-ISO | Disposable DB | `referred_by` and referral code are server-managed. |
| J-007 | Direct KYC review denial | CONTRACT + DB-ISO | Disposable DB | Participant cannot change review state. |
| J-008 | Direct payment approval denial | CONTRACT + DB-ISO | Disposable DB | Only authorized RPC paths can settle payments. |
| J-009 | Admin-view protection | CONTRACT + DB-ISO | Disposable DB | Non-admin queries return no privileged rows. |
| J-010 | Safe `SECURITY DEFINER` search paths | CONTRACT | Migrations | Functions pin trusted schemas and `pg_temp`. |
| J-011 | Function privileges | CONTRACT + DB-ISO | Migrations/disposable DB | Anonymous/public have no financial RPC execution. |
| J-012 | Unauthorized RPC calls | DB-ISO | Disposable DB | Anonymous and normal-user admin RPC calls fail. |
| J-013 | SQL injection inputs | AUTO + DB-ISO | Local/disposable DB | Inputs are parameters; malicious identifiers remain data. |
| J-014 | IDOR | AUTO + DB-ISO | Routes/disposable DB | Foreign IDs cannot be acted on or read. |
| J-015 | Mass assignment | AUTO + DB-ISO | Routes/disposable DB | Extra client fields cannot alter amount, cycle, owner, status, or role. |
| J-016 | Private bucket | CONTRACT + DB-ISO | Migration/disposable storage | Bucket is non-public with 5 MB/MIME controls. |
| J-017 | Upload ownership | CONTRACT + DB-ISO | Disposable storage | First path segment must equal authenticated UUID. |
| J-018 | Duplicate path overwrite | AUTO + DB-ISO | Route/disposable storage | `upsert: false` and unique IDs prevent overwrite. |
| J-019 | Failed-mutation cleanup | AUTO + DB-ISO | Route/disposable storage | New objects are removed after downstream failure. |
| J-020 | Referential/unique constraints | CONTRACT + DB-ISO | Migration/disposable DB | Duplicate identities, positions, hashes, events, and active withdrawals are rejected. |
| J-021 | Transaction atomicity | DB-ISO | Disposable DB | Every multi-ledger financial operation commits or rolls back wholly. |

## K. Rate limiting and abuse protection

| ID | Test | Method | Environment | Expected result |
|---|---|---|---|---|
| K-001 | Registration limit | AUTO + DB-ISO | Harness/disposable DB | 4/hour actor limit is enforced. |
| K-002 | Login limit | AUTO + DB-ISO | Harness/disposable DB | 8/15-minute actor limit is enforced. |
| K-003 | Recovery limit | CONTRACT + SESSION | Provider/project | Effective neutral rate limiting is documented and verified. |
| K-004 | Payment creation limit | AUTO + DB-ISO | Harness/disposable DB | 12/5-minute authenticated-user limit. |
| K-005 | Authorization action limit | AUTO + DB-ISO | Harness/disposable DB | 20/5-minute authenticated-user limit. |
| K-006 | Proof upload limit | AUTO + DB-ISO | Harness/disposable DB | 8/10-minute authenticated-user limit. |
| K-007 | Withdrawal limit | AUTO + DB-ISO | Harness/disposable DB | 6/hour authenticated-user limit. |
| K-008 | KYC upload limit | AUTO + DB-ISO | Harness/disposable DB | 5/hour authenticated-user limit. |
| K-009 | Large JSON payload | AUTO | Route harness | Oversized state/form/API payload is rejected before resource exhaustion. |
| K-010 | Unexpected MIME | AUTO | Local | Client-declared and magic-byte type controls reject it. |
| K-011 | Malformed IDs | AUTO | Route harness | Invalid UUID-shaped values fail safely. |
| K-012 | Excessively long text | AUTO + DB-ISO | Local/disposable DB | Hashes, labels, notes, reasons, and identifiers have effective bounds. |
| K-013 | Safe abuse errors | AUTO | Local | No raw SQL/provider/storage detail is returned. |

## L. Failure and recovery

| ID | Test | Method | Environment | Expected result |
|---|---|---|---|---|
| L-001 | Refresh during submission | SESSION | Local/QA | Persisted result is recoverable; no duplicate effect. |
| L-002 | Browser back after submission | SESSION | Local/QA | UI reloads server truth and does not silently resubmit. |
| L-003 | Double-click | AUTO + SESSION | Local/QA | Synchronous guard prevents a second request. |
| L-004 | Network interruption before response | AUTO + DB-ISO | Harness/disposable DB | Retry with same key returns original result. |
| L-005 | Server timeout | AUTO + DB-ISO | Harness/disposable DB | Safe error and idempotent recovery. |
| L-006 | Database RPC failure | AUTO | Route harness | Safe error; no raw database details. |
| L-007 | Storage success/RPC failure | AUTO + DB-ISO | Harness/disposable storage | Newly created object is cleaned. |
| L-008 | RPC success/response interruption | DB-ISO | Disposable DB | Same-key retry does not duplicate financial effects. |
| L-009 | Expired login session | SESSION | Local/QA | Mutation returns unauthorized and user can sign in again. |
| L-010 | Expired MFA session | SESSION + DB-ISO | Local/disposable DB | Admin mutation fails closed and UI returns read-only. |
| L-011 | Repeated reload | PROD-RO + SESSION | Production | No duplicate effects or console-breaking errors. |
| L-012 | Two-window concurrency | DB-ISO + SESSION | Disposable DB/QA | Locks and idempotency preserve one outcome. |
| L-013 | Same idempotency key | AUTO + DB-ISO | Harness/disposable DB | Original result is returned. |
| L-014 | New idempotency key | DB-ISO | Disposable DB | Business-state constraints still prevent duplicate terminal effects. |

## M. Responsive and accessibility functional QA

| ID | Test | Method | Environment | Expected result |
|---|---|---|---|---|
| M-001 | Public/login/register/reset at 360 px | PROD-RO | Production | No horizontal overflow; fields/actions/alerts remain reachable. |
| M-002 | Public/login/register/reset at 390 px | PROD-RO | Production | Same functional result. |
| M-003 | Public routes at tablet width | PROD-RO | Production | Forms and navigation remain usable. |
| M-004 | Public routes at laptop width | PROD-RO | Production | No clipping or unreachable controls. |
| M-005 | Public routes at standard desktop | PROD-RO | Production | Functional layout and readable validation. |
| M-006 | Public routes at large desktop | PROD-RO | Production | Content remains usable without functional breakage. |
| M-007 | Participant dashboard across widths | SESSION | Production | Metrics, navigation, lists, and sign-out remain reachable. |
| M-008 | Payments across widths | SESSION | Production | Forms, request cards, tables, and action buttons remain usable. |
| M-009 | KYC across widths | SESSION | Production | File controls, progress, validation, and submit remain usable. |
| M-010 | Security center across widths | SESSION | Production | QR, secret, code, password, and actions do not overflow. |
| M-011 | Admin across widths | SESSION | Production | Tables scroll within containers and mutation controls remain reachable. |
| M-012 | Keyboard navigation | PROD-RO + SESSION | Production | Logical order, visible focus, and operable controls. |
| M-013 | Labels and accessible names | CONTRACT + PROD-RO | Local/production | Inputs/buttons/regions have programmatic names. |
| M-014 | Validation announcements | CONTRACT + PROD-RO | Local/production | Errors use alerts; status/progress uses appropriate live regions. |
| M-015 | Touch targets | PROD-RO + SESSION | Production | Essential controls are not impractically small or overlapping. |
| M-016 | Deferred visual issues | PROD-RO + SESSION | Production | Non-blocking visual polish is recorded, not redesigned here. |

## N. Deployment and production regression

| ID | Test | Method | Environment | Expected result |
|---|---|---|---|---|
| N-001 | Required migration chain | CONTRACT | Repository | README and migration contracts cover 001 through latest required migration. |
| N-002 | Vercel deployment | PROD-RO | Vercel | Final commit deploys successfully. |
| N-003 | Production health | PROD-RO | Production | Health endpoint is healthy after deployment. |
| N-004 | Production home/login/register/reset | PROD-RO | Production | Public routes render without console-breaking failures. |
| N-005 | Production participant dashboard | SESSION | Production | Existing participant session loads `/app`. |
| N-006 | Production payments/KYC/security | SESSION | Production | Existing participant session loads core pages safely. |
| N-007 | Production admin routing | PROD-RO + SESSION | Production | Anonymous/participant/admin boundaries behave correctly. |
| N-008 | Production admin AAL1 | SESSION | Production | Admin view is read-only without current AAL2. |
| N-009 | Production baseline unchanged | SESSION + PROD-RO | Production admin | Read-only treasury values match the pre-QA baseline. |
| N-010 | Repository/deployment SHA | CONTRACT + PROD-RO | Git/Vercel | Deployed source SHA matches final repository SHA. |

## Planned automated coverage additions

The current repository suites establish useful source contracts but do not constitute a live database integration suite. New deterministic tests should cover route validation and migration invariants immediately. True concurrency, RLS, storage, trigger, rollback, and ledger tests must run only against a disposable Supabase/PostgreSQL fixture and will be marked blocked if no isolated database credentials are available.

Required automated targets are mapped to: financial formula (`G-001`–`G-007`), referral/fallback (`E-022`–`E-023`), package validation (`E-006`–`E-010`), insufficient balance (`E-011`–`E-012`, `I-005`), idempotency/concurrency (`E-017`–`E-019`, `F-026`, `H-012`, `I-013`–`I-014`), Binance capacity/expiry/guardrails (`F-004`–`F-026`), FIFO/progression (`H-001`–`H-020`), withdrawal integrity (`I-001`–`I-018`), and RLS/RPC security (`J-001`–`J-021`).
