# Welfrise Functional Regression Report v1.0

Prepared: 2026-07-24
Matrix: `docs/WELFRISE_COMPLETE_QA_TEST_MATRIX_v1.0.md`
Audited baseline: `484f12e1b4f6751932dc36ab28bd0edac2d8221e`
Fix commits under test: `9604bd3551fcdd6b652f01518da5c62b290d3d28`, `8fbd96edbad5b37d5f48249a8be65eed7f1b3722`
Controlled QA Closure baseline: `705fd72fc22126ef0289aaff53a0f9d69bf21dad`

## Overall result

**NO-GO at the controlled QA Closure gate for further closed-pilot financial, payment, KYC, withdrawal, or admin mutation activity.**
**NO-GO for public real-money launch.**

The earlier application, contract, and anonymous production evidence remains valid, but it does not close the database gate. A repeated capability check found no Supabase CLI, Docker-compatible runtime, PostgreSQL client, database/Supabase credentials, isolated QA project, or authenticated production session. The available production browser redirected `/app` to `/login`. Therefore Migration 006 rehearsal/application, functional database/RLS/RPC/Storage/rollback/concurrency execution, and the production Treasury read were not performed. No source-contract check was converted into a functional pass.

## Matrix counts

| Result | Count |
|---|---:|
| Total | 271 |
| Passed | 59 |
| Failed | 1 |
| Blocked | 211 |
| Not safely testable | 0 |

Classification is deliberately strict. A row containing `DB-ISO` or `SESSION` is blocked unless its complete expected result was independently evidenced. Source contracts do not convert a database execution case into a pass. The one failure is M-015 (small public-page touch targets); it is non-blocking and recorded for the UI/UX audit. Scenarios involving real funds were designed for disposable fixtures, so they are blocked rather than counted as unsafe production tests.

Counts are unchanged after the closure attempt because no new functional evidence was available.

## Controlled QA Closure evidence

| Closure requirement | Result | Evidence |
|---|---|---|
| Exact Migration 006 rehearsal/application procedure | PREPARED | `docs/WELFRISE_MIGRATION_006_QA_CLOSURE_RUNBOOK_v1.0.md` |
| Canonical duplicate payout-hash preflight | BLOCKED | Exact read-only `lower(btrim(payout_tx_hash))` query prepared; no production database access |
| Migrations 001–006 isolated rehearsal | BLOCKED | No Supabase CLI, Docker-compatible runtime, database credential, or QA project |
| Database/RLS/RPC/Storage execution | BLOCKED | No isolated project or role-specific authenticated sessions |
| Rollback and concurrency execution | BLOCKED | No disposable database or two independent authenticated clients/sessions |
| Production Migration 006 application | NOT ATTEMPTED | Rehearsal acceptance gate not met |
| Production Treasury baseline | BLOCKED | No authenticated production admin AAL2 session |

The pending Migration 006 payout-hash unique index now uses the same canonical form required by the preflight: `lower(btrim(payout_tx_hash))`, excluding null or blank values. This is a financial-integrity alignment, not a payout or withdrawal-rule change.

Safe local regression was re-run after the closure artifacts were prepared:

| Validation | Closure result |
|---|---|
| MVP invariant verification | PASS — 18/18 |
| ESLint | PASS |
| TypeScript | PASS |
| Unit tests | PASS — 22/22 |
| Migration/source contracts | PASS — 29/29 |
| Route/component tests | PASS — 57/57 |
| Next.js production build | PASS — 20 static pages generated |

The initial sandboxed build compiled but Windows denied a worker spawn with `EPERM`; the identical build passed when re-run with the required process permission. This was an execution-environment restriction, not an application or TypeScript failure.

## Passed matrix IDs

- A-001–A-020
- B-014, B-016, B-021, B-024, B-025, B-028, B-030, B-031, B-033
- C-014, C-015
- D-004, D-005, D-006, D-007, D-022
- E-009
- F-008
- I-019
- J-001, J-010
- K-009, K-010, K-011, K-013
- L-006
- M-001–M-006, M-013, M-014
- N-001–N-004, N-010

## Failed matrix IDs

- M-015 — public secondary touch targets are reachable and non-overlapping but below comfortable touch sizing at mobile widths.

## Blocked matrix IDs

- B-001–B-013, B-015, B-017–B-020, B-022–B-023, B-026–B-027, B-029, B-032, B-034
- C-001–C-013, C-016
- D-001–D-003, D-008–D-021
- E-001–E-008, E-010–E-024
- F-001–F-007, F-009–F-026
- G-001–G-015
- H-001–H-020
- I-001–I-018, I-020
- J-002–J-009, J-011–J-021
- K-001–K-008, K-012
- L-001–L-005, L-007–L-014
- M-007–M-012, M-016
- N-005–N-009

## Automated validation evidence

| Validation | Result | Evidence |
|---|---|---|
| Clean install | PASS | npm 10.9.2 clean install completed; 354 packages installed, 355 audited, 0 vulnerabilities |
| Lockfile | PASS | Valid JSON, lockfileVersion 3, root dependency metadata matches `package.json` |
| Production dependency audit | PASS | `npm audit --omit=dev`: 0 vulnerabilities |
| MVP verify | PASS | 18/18 assertions |
| ESLint | PASS | Exit 0 |
| TypeScript | PASS | `tsc --noEmit`, exit 0 |
| Unit tests | PASS | 22/22 |
| Migration/security contracts | PASS | 29/29 after fixes; pre-fix reproduction was 11 pass / 4 fail for the initial added regressions |
| Route/component tests | PASS | 57/57 after fixes; pre-fix reproduction was 53 pass / 4 fail |
| Next.js production build | PASS | Next.js 16.2.11 build completed and generated 20 static pages |
| Tracked secret scan | PASS | No credential, service-role key, private key, or committed environment file found |

Automated case total: **126 passed, 0 failed** (18 verifier assertions + 22 unit + 29 integration/contract + 57 route/component).

## Production read-only evidence

- `/`, `/login`, `/register`, and `/reset-password` rendered without console-breaking errors.
- `/reset-password` displayed a fixed inline missing-link error without raw tokens or provider details.
- Anonymous requests to `/app`, `/app/payments`, `/app/kyc`, `/account/security`, and `/admin` redirected to `/login` without exposing private content.
- One invalid reserved-domain login request returned HTTP 400 with the neutral message `Email or password is incorrect.`
- `/api/health` returned HTTP 200 with the fixed non-sensitive service payload.
- Production responses included HSTS, CSP, `X-Content-Type-Options`, frame denial, referrer policy, permissions policy, and noindex headers.
- Public pages were checked at 360, 390, 768, 1366, 1440, and 1920 CSS pixels with no horizontal overflow or clipped essential action.
- No password reset email, invitation, KYC upload, wallet request, payment request, withdrawal, approval, payout, or blockchain action was initiated.

## Core workflow status

| Workflow | Status | Evidence and condition |
|---|---|---|
| Authentication | PARTIAL / FUNCTIONAL BLOCKED | Public/login/recovery contracts and anonymous production boundary pass; invitation consumption, valid sessions, logout, expiry, and cross-account behavior need isolated/authenticated execution. |
| Admin MFA | CONTRACT PASS / FUNCTIONAL BLOCKED | UI, Server Action, RPC AAL2, async-export, inline-error, and admin-only-role contracts pass; live AAL1/AAL2 transition is blocked. |
| KYC | CONTRACT PASS / FUNCTIONAL BLOCKED | File signatures, 4 MB aggregate, progress, inline errors, RPC-only metadata, AAL2 review, and private policy contracts pass; live upload/review/signed URL lifecycle is blocked. |
| User Wallet | CONTRACT PASS / FUNCTIONAL BLOCKED | Server-derived packages, participant-referrer binding, balance/row-lock/idempotency contracts pass; actual debit/decline/cancel/concurrent settlement is blocked. |
| Binance | CONTRACT PASS / FUNCTIONAL BLOCKED | Internal selection, capacity lock, canonical hash, expiry, proof cleanup, duplicate hash, and approval checklist contracts pass; independent on-chain verification and DB execution remain blocked. |
| Financial ledger | CONTRACT PASS / FUNCTIONAL BLOCKED | Exact $10 allocation and append-only/atomic source contracts pass; live reconciliation and rollback execution are blocked. |
| Referral | CONTRACT PASS / FUNCTIONAL BLOCKED | Registered active referrer and charity fallback contracts pass; transaction execution is blocked. |
| FIFO | CONTRACT PASS / FUNCTIONAL BLOCKED | Atomic per-level/cycle counter, unique position, thresholds, earliest waiting selection, and payout constants pass source contracts; positions/concurrency execution is blocked. |
| Level progression | CONTRACT PASS / FUNCTIONAL BLOCKED | Locked-level, unlock-once, Level 5 completion, and paid Level 1 new-cycle contracts pass; live transaction execution is blocked. |
| Withdrawal | CONTRACT PASS / FUNCTIONAL BLOCKED | KYC gate, 5% fee, daily bounds, exact hold, fail-closed release, and canonical unique payout reference contracts pass; lifecycle/concurrency execution is blocked. |
| RLS/security | CONTRACT PASS / FUNCTIONAL BLOCKED | Migration 006 contains fixes for confirmed role/profile/KYC/private-object bypasses; direct orphan Storage uploads and CSP hardening remain open; Migration 006 is not live and functional RLS execution is blocked. |
| Deployment | PASS | Final main-branch deployment and health were verified after push; authenticated routes remain unverified due missing session. |

## Locked-rule regression

The following remained unchanged in source and executable contracts:

- Packages: 1/$10, 2/$20, 5/$50, 10/$100; no other slot count.
- Maximum 10 active waiting slots per participant, level, and cycle.
- FIFO is separate per level/cycle; atomic counters and unique positions prevent reordering/duplication.
- Payout trigger positions 11/21/31… and earliest waiting queue head.
- Level payouts: $20, $100, $1,000, $10,000, $100,000.
- First completion unlocks the next level; Level 5 completes the championship; a new paid Level 1 entry begins the next cycle.
- Referral commission follows the participant's registered active referrer; otherwise it falls back to charity.
- Per-$10 allocation remains $1 charity, $1 referral/fallback, $4.50 reserve, $3.50 operations.
- User Wallet remains an owner-authorization payment flow, not a general transfer.
- Binance receiving-wallet capacity, priority, and rotation remain internal.
- Withdrawal fee remains 5% gross and 95% net.

## Production baseline

The required baseline values were **not queried** because there was no authenticated AAL2 admin session. No QA mutation was performed, so this audit did not alter receipts, allocations, balances, slots, payouts, or exposure. The expected baseline remains:

- Confirmed receipts $20
- Charity $3
- Referral commissions $1
- Level Bonus Reserve $9
- Operations $7
- Available-wallet liabilities $1
- Level 1 waiting slots 2
- Nominal payout exposure $40

An authorized owner must execute the read-only baseline query in `docs/WELFRISE_MIGRATION_006_QA_CLOSURE_RUNBOOK_v1.0.md` after applying Migration 006 and before any further pilot financial activity.

## Required release actions

1. Provision the tooling, isolated Supabase QA project, synthetic fixtures, and role-specific AAL1/AAL2 sessions listed in `docs/WELFRISE_MIGRATION_006_QA_CLOSURE_RUNBOOK_v1.0.md`.
2. Apply migrations 001–006 to the isolated project and execute the blocked transaction/RLS/RPC/Storage/rollback/concurrency suite.
3. Run the canonical trimmed, lower-case production duplicate payout-hash preflight, then apply Migration 006 only if it returns zero rows and the rehearsal gate passes.
4. Verify the production Treasury baseline at AAL2 without changing data.
5. Document Supabase Auth password-recovery rate limits.
6. Maintain manual independent on-chain verification for the closed pilot; implement a trusted verifier/dual control before public real-money use.

## Decision

- **Closed-pilot continuation:** NO-GO at this closure gate. Resume financial, payment, KYC, withdrawal, and admin mutation activity only after the runbook passes, Migration 006 is applied and verified, and the owner confirms the unchanged Treasury baseline. Read-only incident-safe access may continue under owner control.
- **Public real-money launch:** NO-GO. Legal approval, security assurance, independent on-chain verification, treasury funding/payout sustainability, operational readiness, all High findings, and blocked transactional evidence must be independently resolved.
