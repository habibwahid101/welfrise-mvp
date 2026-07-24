# Welfrise Complete QA Findings v1.0

Prepared: 2026-07-24
Baseline audited: `484f12e1b4f6751932dc36ab28bd0edac2d8221e`
Fix commits: `9604bd3551fcdd6b652f01518da5c62b290d3d28`, `8fbd96edbad5b37d5f48249a8be65eed7f1b3722`
Scope: invitation-only closed pilot. No production financial, KYC, invitation, wallet, slot, payout, or blockchain state was mutated.

## Finding summary

| ID | Severity | Area | Result |
|---|---|---|---|
| QA-H-001 | High | Database authorization | Fixed in Migration 006 |
| QA-H-002 | High | Profile privilege boundary | Fixed in Migration 006 |
| QA-H-003 | High | Private storage authorization | Fixed in Migration 006 |
| QA-H-004 | High | KYC metadata authorization | Fixed in Migration 006 |
| QA-H-005 | High | KYC/Binance upload reliability | Fixed in application and Migration 006 |
| QA-H-006 | High | Withdrawal financial integrity | Fixed in Migration 006 |
| QA-H-007 | High | On-chain approval assurance | Open; closed-pilot operational control required |
| QA-M-001 | Medium | Binance transaction validation | Fixed |
| QA-M-002 | Medium | Binance expiry recovery | Fixed |
| QA-M-003 | Medium | Mutation retry idempotency | Fixed for same-page retries |
| QA-M-004 | Medium | Direct Storage API abuse | Open; architecture decision required |
| QA-M-005 | Medium | Password-recovery abuse protection | Evidence blocked at provider configuration |
| QA-M-006 | Medium | Content Security Policy | Open hardening item |
| QA-M-007 | Medium | QA environment/evidence | Open operational blocker |
| QA-M-008 | Medium | Superseded KYC document retention | Open operational hardening |
| QA-L-001 | Low | Public-page touch targets | Deferred to UI/UX audit |
| QA-L-002 | Low | Password-policy consistency | Owner decision required |
| QA-L-003 | Low | Legacy state endpoint rate limiting | Deferred cleanup/hardening |

Defect counts: **Critical 0, High 7, Medium 8, Low 3**. One High remains open for public real-money use. No Critical defect was confirmed in the evidence available to this audit.

## QA-H-001 — Non-admin staff labels inherited all database admin privileges

- **Area:** Admin MFA and database authorization
- **Severity:** High
- **Environment:** Migration/source audit
- **Preconditions:** An authenticated AAL2 account whose profile role was `finance` or `compliance`.
- **Exact reproduction steps:** Inspect `public.is_admin()` in Migration 001; observe `role in ('admin','finance','compliance')`. Inspect the AAL2 admin wrapper RPCs; observe that they authorize through this helper while the application admin page and Server Actions require `role = 'admin'`.
- **Expected result:** Only the approved admin role can invoke the complete set of financial, KYC, wallet, withdrawal, and Binance admin RPCs.
- **Actual result:** Finance and compliance role labels could bypass the application role boundary and call the shared RPC set directly when at AAL2.
- **Evidence:** Migration 001 lines defining `is_admin`; application checks in `src/app/admin/page.tsx` and `src/app/admin/actions.ts`; new passing migration contract.
- **Root cause:** Database and application role definitions were inconsistent.
- **Fix:** Migration 006 replaces `is_admin()` with an admin-only definition while preserving AAL2 enforcement.
- **Commit SHA:** `9604bd3551fcdd6b652f01518da5c62b290d3d28`
- **Retest result:** PASS — Migration 006 admin-boundary contract passes.
- **Remaining risk:** Role-specific finance/compliance capabilities are not implemented. Any future delegation needs separate least-privilege RPCs and an explicit owner-approved role matrix.

## QA-H-002 — Broad profile update path bypassed audited server workflows

- **Area:** Profiles, KYC gate, progression, referrals, authorization
- **Severity:** High
- **Environment:** Migration/source audit
- **Preconditions:** An authenticated account accepted by the former `profiles_admin_update` policy.
- **Exact reproduction steps:** Inspect Migration 002; observe `profiles_admin_update` permitting all-column updates when `public.is_admin()` is true and the retained table-level UPDATE grant. Compare with the AAL2/audited KYC and financial RPCs.
- **Expected result:** Managed fields such as role, KYC state, registered referrer, level, and championship state change only through authorized server/database workflows.
- **Actual result:** A direct PostgREST profile update could bypass Server Actions, AAL2 review wrappers, and audit logging.
- **Evidence:** Reproduced as four failing Migration 006 contracts before the migration existed; source policy/grant inspection.
- **Root cause:** Migration 002 added a broad admin RLS policy, while Migration 003 revoked function privileges but did not remove the table update grant/policy.
- **Fix:** Drop the broad policy, revoke table-level UPDATE, and regrant only `full_name` and `phone` to authenticated users.
- **Commit SHA:** `9604bd3551fcdd6b652f01518da5c62b290d3d28`
- **Retest result:** PASS — focused contract confirms the exact revoke and column grant.
- **Remaining risk:** Migration 006 must be applied to live Supabase before the repository fix becomes effective.

## QA-H-003 — AAL1 administrative sessions could read or delete private evidence

- **Area:** Supabase Storage, KYC, payment proof
- **Severity:** High
- **Environment:** Migration/source audit
- **Preconditions:** An authenticated admin-compatible role at AAL1 with a known private-object path.
- **Exact reproduction steps:** Inspect the Storage SELECT and DELETE policies from Migrations 001/002; their admin branch calls `public.is_admin()` without checking the JWT assurance level. Compare with the application, which creates signed evidence links only at AAL2.
- **Expected result:** Administrative access to private KYC and payment evidence requires an admin role and AAL2.
- **Actual result:** Direct Storage API access did not share the application MFA boundary.
- **Evidence:** Failing pre-fix Migration 006 policy contract; migration policy inspection.
- **Root cause:** Storage policies predated the database-level AAL2 admin wrappers.
- **Fix:** Recreate the read/delete policies with owner access unchanged and an admin branch requiring `auth.jwt()->>'aal' = 'aal2'`.
- **Commit SHA:** `9604bd3551fcdd6b652f01518da5c62b290d3d28`
- **Retest result:** PASS — both policy contracts pass.
- **Remaining risk:** Live protection depends on applying Migration 006; existing signed URLs remain valid until their short expiry.

## QA-H-004 — Authenticated users retained direct KYC metadata writes

- **Area:** KYC workflow and table privileges
- **Severity:** High
- **Environment:** Migration/source audit
- **Preconditions:** Authenticated user with access to their KYC row.
- **Exact reproduction steps:** Inspect Migration 001 table grants and the own-row KYC INSERT/UPDATE policies. Observe that the application now writes through `submit_kyc_metadata_v2`, but the original direct table privileges remained.
- **Expected result:** KYC metadata changes pass through the controlled submission RPC; reviews pass through the admin AAL2 RPC.
- **Actual result:** A caller could bypass route-level file validation and submission checks by writing the KYC table directly within the permissive own-row policy.
- **Evidence:** Table-grant/RLS inspection and new RPC-boundary contract.
- **Root cause:** Direct MVP-era grants were not revoked when the hardened RPC was added.
- **Fix:** Migration 006 revokes authenticated INSERT and UPDATE on `public.kyc_submissions`; the security-definer submission/review RPCs remain the entry points.
- **Commit SHA:** `9604bd3551fcdd6b652f01518da5c62b290d3d28`
- **Retest result:** PASS — direct privilege revoke and intended RPC grants are asserted.
- **Remaining risk:** Authenticated users can still create orphaned objects directly in their own Storage prefix; see QA-M-004.

## QA-H-005 — Advertised private uploads exceeded Vercel's request-body ceiling

- **Area:** KYC and Binance proof uploads; Vercel compatibility
- **Severity:** High
- **Environment:** Source contract plus platform documentation
- **Preconditions:** A valid proof near 5 MB or three valid KYC files whose multipart request exceeds the Function limit.
- **Exact reproduction steps:** Observe the prior 5,000,000-byte per-file validators and 5 MB Storage bucket limit. Compare with Vercel's documented 4.5 MB Function request/response body limit. A KYC form could construct roughly 15 MB before multipart overhead.
- **Expected result:** Every client-accepted request reaches application validation within the hosting limit.
- **Actual result:** Valid UI selections could be rejected by the platform before the route ran.
- **Evidence:** Four new route tests failed before the fix; [Vercel Function limits](https://vercel.com/docs/functions/limitations) and [Vercel's body-size guidance](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions); source constants.
- **Root cause:** Storage object size was treated as equivalent to the hosting platform's aggregate request size.
- **Fix:** Set private-file and aggregate KYC limits to 4,000,000 bytes, validate aggregate size on client and server, update safe messages, and align the bucket limit in Migration 006.
- **Commit SHA:** `9604bd3551fcdd6b652f01518da5c62b290d3d28`, `8fbd96edbad5b37d5f48249a8be65eed7f1b3722`
- **Retest result:** PASS — upload ceiling regression passes and production build succeeds.
- **Remaining risk:** Vercel may change platform limits; keep the application ceiling below the current documented limit and revalidate after platform/runtime changes.

## QA-H-006 — Withdrawal rejection/completion could tolerate a short held balance

- **Area:** Withdrawal financial integrity
- **Severity:** High
- **Environment:** Migration/source audit
- **Preconditions:** An inconsistent wallet row whose held balance is below the withdrawal gross amount, followed by admin rejection or completion.
- **Exact reproduction steps:** Inspect the original `review_withdrawal_request`; observe `greatest(0, held_balance - gross)` and, on rejection, an unconditional full-gross credit to available balance.
- **Expected result:** Review fails atomically if the exact gross hold is not present.
- **Actual result:** Rejection could add the full gross to available even when the corresponding hold was short, creating value in an already inconsistent state.
- **Evidence:** Failing pre-fix contract; original function body; passing fail-closed contract after Migration 006.
- **Root cause:** Defensive clamping hid an invariant violation instead of refusing the financial mutation.
- **Fix:** Conditional wallet updates require `held_balance >= gross`; no updated row raises an exception and rolls back. Completion also requires a canonical, case-insensitively unique payout hash.
- **Commit SHA:** `9604bd3551fcdd6b652f01518da5c62b290d3d28`
- **Retest result:** PASS at source-contract level.
- **Remaining risk:** Transactional execution against disposable PostgreSQL was blocked; Migration 006 must be rehearsed and exercised before production use.

## QA-H-007 — On-chain approval remains an operator-attestation control

- **Area:** Binance approval and fraud prevention
- **Severity:** High
- **Environment:** Source/RPC audit; production mutation intentionally not performed
- **Preconditions:** A submitted payment proof and an AAL2 admin.
- **Exact reproduction steps:** Inspect `review_binance_payment_v2`. It requires chain, configured token contract, recipient, amount, success, block, confirmations, source, method, and match booleans, but receives those values from the admin action rather than querying an independent chain service.
- **Expected result:** A payment cannot be approved without successful independent on-chain verification.
- **Actual result:** The software enforces a strong checklist and persists evidence, but it cannot itself prove the operator independently checked the chain.
- **Evidence:** RPC and admin-form inspection. No real or fabricated transaction was approved.
- **Root cause:** No trusted chain-indexer/RPC verifier is integrated; manual verification is the configured method.
- **Fix:** None in this audit. Closed-pilot procedure must require an independent explorer/RPC check by an authorized AAL2 admin. Public use needs a trusted verifier or dual-control evidence design approved by the owner.
- **Commit SHA:** Not fixed.
- **Retest result:** Guardrail contract PASS; independent verification execution BLOCKED.
- **Remaining risk:** High for public real-money launch; operationally controlled but not eliminated in the closed pilot.

## QA-M-001 — Binance transaction references accepted non-transaction strings

- **Area:** Payment proof validation
- **Severity:** Medium
- **Environment:** Route and database source
- **Preconditions:** Awaiting Binance request and arbitrary 10–180 character text.
- **Exact reproduction steps:** Observe the prior route and RPC length-only validation.
- **Expected result:** BEP20/EVM transaction reference is `0x` plus 64 hexadecimal characters.
- **Actual result:** Arbitrary text meeting the length range was accepted for review.
- **Evidence:** Red route/migration regressions before fix.
- **Root cause:** Generic length validation was used for a network-specific reference.
- **Fix:** Canonical validation at browser, route, and RPC boundaries; normalized lower-case storage.
- **Commit SHA:** `9604bd3551fcdd6b652f01518da5c62b290d3d28`, `8fbd96edbad5b37d5f48249a8be65eed7f1b3722`
- **Retest result:** PASS.
- **Remaining risk:** Hash shape does not establish chain existence; QA-H-007 still applies.

## QA-M-002 — Expired proof submission rolled back its own reservation release

- **Area:** Binance expiry and capacity recovery
- **Severity:** Medium
- **Environment:** PostgreSQL function audit
- **Preconditions:** Proof submission after `expires_at` while status remained `awaiting_payment`.
- **Exact reproduction steps:** Follow the original expired branch: update the wallet reservation, update request status, then raise an exception. PostgreSQL rolls back all changes made in the exception-raising transaction.
- **Expected result:** Expiry and capacity release commit exactly once.
- **Actual result:** The immediate submission path reported expiry but did not durably release it; later cleanup was required.
- **Evidence:** Red migration/route regressions before fix.
- **Root cause:** An exception was used after the desired transactional updates.
- **Fix:** Return the `expired` state; route deletes the newly uploaded proof and returns a safe 409.
- **Commit SHA:** `9604bd3551fcdd6b652f01518da5c62b290d3d28`, `8fbd96edbad5b37d5f48249a8be65eed7f1b3722`
- **Retest result:** PASS at contract level.
- **Remaining risk:** Disposable database concurrency execution remains blocked.

## QA-M-003 — Same-page retry generated a new idempotency key

- **Area:** Payment and withdrawal failure recovery
- **Severity:** Medium
- **Environment:** Client source/route harness
- **Preconditions:** Mutation reaches the server but the response is interrupted; user retries without reloading.
- **Exact reproduction steps:** Observe the prior `mutationHeaders()` generating `crypto.randomUUID()` on every invocation.
- **Expected result:** A retry of the same logical operation reuses its key until success.
- **Actual result:** Retry used a new key and could create a second pending request even though terminal settlement guards remained idempotent.
- **Evidence:** Red route/component regression before fix.
- **Root cause:** Idempotency keys had request-call lifetime instead of logical-operation lifetime.
- **Fix:** Store keys in a component `Map`, scope them to operation inputs, and clear only after a successful response.
- **Commit SHA:** `8fbd96edbad5b37d5f48249a8be65eed7f1b3722`
- **Retest result:** PASS.
- **Remaining risk:** A full page reload loses the in-memory key. Database terminal-state uniqueness limits financial duplication, but durable client retry tokens would provide stronger recovery.

## QA-M-004 — Direct authenticated Storage uploads bypass route validation and rate limiting

- **Area:** Supabase Storage abuse protection
- **Severity:** Medium
- **Environment:** Storage policy/source audit
- **Preconditions:** Any authenticated participant using the Supabase Storage API directly.
- **Exact reproduction steps:** Inspect `welfrise_storage_insert_own`: an authenticated user may insert into their own first-level folder. The application route's magic-byte checks and distributed upload rate limit are not distinguishable at the Storage policy boundary.
- **Expected result:** All retained KYC/proof objects pass content validation, path binding, and abuse controls.
- **Actual result:** Migration 006 prevents direct KYC metadata attachment, but an authenticated user can still create orphaned allowed-MIME objects under their prefix.
- **Evidence:** Policy and route architecture inspection.
- **Root cause:** The server route uses the participant JWT, so Storage cannot distinguish route-originated uploads from direct client uploads.
- **Fix:** No safe local fix without a trusted backend upload credential, signed one-time upload authorization, or Edge Function design. Do not add a service-role key to the browser.
- **Commit SHA:** Partially mitigated by `9604bd3551fcdd6b652f01518da5c62b290d3d28`.
- **Retest result:** KYC attachment bypass fixed; direct orphan upload remains OPEN.
- **Remaining risk:** Bounded 4 MB object storage consumption and unvalidated orphan content until lifecycle cleanup.

## QA-M-005 — Password-recovery rate control could not be evidenced

- **Area:** Authentication abuse protection
- **Severity:** Medium
- **Environment:** Supabase project configuration; inaccessible in this audit
- **Preconditions:** Repeated anonymous password-reset requests.
- **Exact reproduction steps:** Inspect the login client: it calls Supabase `resetPasswordForEmail` directly and always shows neutral copy. No application database rate-limit scope wraps this client call. Provider-side limits require project-dashboard evidence.
- **Expected result:** Neutral responses plus an effective provider or server-side request limit.
- **Actual result:** Anti-enumeration is verified; the effective Supabase rate-limit configuration was not accessible.
- **Evidence:** Client source and absence of a recovery scope in `welfrise_check_rate_limit`; no provider credentials/configuration available.
- **Root cause:** Recovery is intentionally delegated to Supabase Auth.
- **Fix:** Owner should capture the configured Supabase Auth email/rate limits or proxy recovery through a neutral, rate-limited server endpoint.
- **Commit SHA:** Not fixed.
- **Retest result:** BLOCKED.
- **Remaining risk:** Email abuse if provider limits are absent or too permissive.

## QA-M-006 — CSP permits inline script/style execution

- **Area:** Browser security headers
- **Severity:** Medium
- **Environment:** Production response headers
- **Preconditions:** A separate HTML/script injection flaw.
- **Exact reproduction steps:** Request a production page and inspect `Content-Security-Policy`; `script-src` and `style-src` include `'unsafe-inline'`.
- **Expected result:** A nonce/hash-based CSP minimizes impact of injected inline content.
- **Actual result:** Strong frame/object/base restrictions are present, but inline execution remains allowed.
- **Evidence:** Production header capture on 2026-07-24.
- **Root cause:** Static CSP configuration favors framework compatibility and has no per-request nonce pipeline.
- **Fix:** Defer to a dedicated Next.js nonce/hash implementation and regression pass; do not remove directives blindly.
- **Commit SHA:** Not fixed.
- **Retest result:** OPEN.
- **Remaining risk:** CSP provides less XSS defense-in-depth than a nonce-based policy.

## QA-M-007 — No isolated database or authenticated QA session was available

- **Area:** QA evidence and release assurance
- **Severity:** Medium
- **Environment:** Local workstation and production
- **Preconditions:** Complete transactional/RLS/concurrency verification.
- **Exact reproduction steps:** Repeat the controlled closure capability check at `705fd72fc22126ef0289aaff53a0f9d69bf21dad`: inspect command availability, non-secret environment-variable names, Supabase local configuration, and the existing production browser session. No Supabase CLI, Docker, PostgreSQL client, Supabase/database credential, isolated QA project, or authenticated session is available; `/app` redirects to `/login`. No password may be assumed.
- **Expected result:** Disposable PostgreSQL/Supabase fixtures and existing participant/admin sessions support safe execution without production pollution.
- **Actual result:** 211 matrix scenarios requiring DB isolation or authenticated context could not be executed.
- **Evidence:** 2026-07-24 tooling/environment inventory, names-only environment inspection, repository configuration inspection, and anonymous protected-route redirect. No secret value was printed.
- **Root cause:** No dedicated QA environment or authorized sessions were supplied.
- **Fix:** Provision a non-production Supabase project seeded with synthetic fixtures, plus documented participant/admin AAL1/AAL2 QA sessions, then execute `docs/WELFRISE_MIGRATION_006_QA_CLOSURE_RUNBOOK_v1.0.md`.
- **Commit SHA:** Not applicable.
- **Retest result:** BLOCKED.
- **Remaining risk:** Source contracts cannot prove live RLS, transaction rollback, concurrency, treasury reconciliation, or signed-in production behavior. Migration 006 remains unapplied and its seven High-severity fixes are not live.

### QA Closure Phase addendum

- The required canonical duplicate-withdrawal-hash preflight is now specified as `lower(btrim(payout_tx_hash))`; it has not been run against production.
- The pending Migration 006 unique index is aligned to the same trimmed, lower-case canonical form.
- Migrations 001–006 have not been rehearsed in this phase.
- The production Treasury baseline has not been queried.
- No new defect was created and no severity count changed: Critical 0, High 7, Medium 8, Low 3.
- Closure decision: `NO-GO` for further closed-pilot financial/KYC/admin mutation activity until the runbook passes; public real-money launch remains `NO-GO`.

## QA-M-008 — Superseded KYC object deletion is not operationally reconciled

- **Area:** Private-document retention
- **Severity:** Medium
- **Environment:** KYC route source
- **Preconditions:** Successful resubmission after rejection followed by a Storage deletion failure for old paths.
- **Exact reproduction steps:** Inspect the successful KYC route: the old-path `remove` result is awaited but not checked after the new metadata commit.
- **Expected result:** Superseded sensitive documents are removed or queued for auditable cleanup.
- **Actual result:** A deletion failure can leave inaccessible-to-UI but still retained private objects.
- **Evidence:** Route control-flow inspection.
- **Root cause:** Metadata commit and Storage lifecycle are not one transaction.
- **Fix:** Add a privileged scheduled orphan reconciliation/lifecycle process with audit evidence; returning submission failure after metadata success would be misleading and was not introduced.
- **Commit SHA:** Not fixed.
- **Retest result:** OPEN.
- **Remaining risk:** Excess retention of private KYC material, limited by private bucket policies.

## QA-L-001 — Several public secondary controls are below common touch-target guidance

- **Area:** Responsive accessibility
- **Severity:** Low
- **Environment:** Production at 360 px and 390 px
- **Preconditions:** Touch input on login/register pages.
- **Exact reproduction steps:** Measure the rendered secondary controls. The Forgot password control was approximately 140×24 px; Create one and Sign in links were approximately 72×16 and 47×16 px.
- **Expected result:** Comfortable, non-overlapping touch targets for essential controls.
- **Actual result:** Controls are reachable and non-overlapping but vertically small.
- **Evidence:** Browser bounding-box inspection across mobile widths.
- **Root cause:** Text-link sizing without a larger interactive padding box.
- **Fix:** Deferred to the separate UI/UX audit because no workflow is blocked.
- **Commit SHA:** Not fixed.
- **Retest result:** FAIL for M-015; functional navigation otherwise passes.
- **Remaining risk:** Reduced usability for touch and motor-impaired users.

## QA-L-002 — Registration and post-registration password minimums differ

- **Area:** Authentication consistency
- **Severity:** Low
- **Environment:** Source audit
- **Preconditions:** New registration versus password change/recovery.
- **Exact reproduction steps:** Compare registration's 8-character minimum with security-center and recovery 12-character minimums.
- **Expected result:** One documented password policy or an intentional staged policy.
- **Actual result:** Registration permits 8 while later password changes require 12.
- **Evidence:** Registration API/page and security/recovery source.
- **Root cause:** Password recovery hardening preserved the pre-existing registration rule.
- **Fix:** Owner decision required because the prior approved task explicitly preserved registration rules.
- **Commit SHA:** Not fixed.
- **Retest result:** OPEN.
- **Remaining risk:** Newly registered passwords may be weaker than later passwords, subject to Supabase provider policy.

## QA-L-003 — Legacy state writes have no distributed rate limit

- **Area:** Legacy API/abuse protection
- **Severity:** Low
- **Environment:** Source audit
- **Preconditions:** Authenticated user calling `/api/state` repeatedly.
- **Exact reproduction steps:** Inspect the PUT handler: it validates object shape and a 2,000,000-character ceiling, then upserts one owner-bound row without calling the distributed rate limiter.
- **Expected result:** Unused legacy write surfaces are retired or rate-limited.
- **Actual result:** Repeated owner-bound large writes are possible, although they cannot change financial tables and overwrite one row.
- **Evidence:** Route and RLS inspection; no current production component calls the endpoint.
- **Root cause:** Compatibility endpoint retained from the prototype.
- **Fix:** Confirm no supported client needs it, then remove PUT or add an explicit scope and smaller schema-bound payload.
- **Commit SHA:** Not fixed.
- **Retest result:** OPEN.
- **Remaining risk:** Authenticated database/write amplification with limited storage growth.

## Locked-rule confirmation

The fixes do not change the approved financial or participation model. Contract tests confirm package values 1/2/5/10 slots at $10 each, Level 1 payout $20, Levels 2–5 payouts $100/$1,000/$10,000/$100,000, FIFO thresholds 11/21/31…, registered-referrer commission with charity fallback, $1/$1/$4.50/$3.50 allocation, 10-waiting-slot cap, server-controlled cycle progression, User Wallet owner authorization, internal Binance selection, and a 5% withdrawal fee.
