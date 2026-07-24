# Welfrise UI/UX Deferred Issues Register v1.0

Prepared: 2026-07-24
Boundary: this functionality QA did not redesign the interface. Functional, security, accessibility, or data-integrity blockers were eligible for correction; non-blocking presentation work is deferred to the dedicated UI/UX audit.

## Confirmed deferred items

| ID | Severity | Surface | Evidence | Deferred recommendation |
|---|---|---|---|---|
| UX-001 | Low | Login/Register mobile secondary actions | At 360/390 px, Forgot password was approximately 140×24 px; Create one and Sign in links approximately 72×16 and 47×16 px. Controls remain reachable and do not overlap. | Add padding/minimum block size while preserving the compact hierarchy. Validate against a documented touch-target standard. |
| UX-002 | Low | Login recovery disclosure | Recovery appears below the main login card and can make the page vertically long on small screens. No clipping or overflow was observed. | Review spacing, disclosure animation, and focus placement in the visual audit. |
| UX-003 | Low | Reset-password missing-link state | Safe inline copy works, but the empty/invalid state occupies the same large authentication card as the full form. | Review information hierarchy and recovery help text without exposing provider details. |
| UX-004 | Low | Public-page large-desktop density | At 1920 px, authentication forms remain intentionally narrow and leave substantial whitespace. This does not block use. | Evaluate max-width and supporting pilot context during the visual-design pass. |

## Authenticated surfaces requiring dedicated visual evidence

These are not confirmed UI defects. They remain inspection items because no existing authenticated participant/admin session was available.

| ID | Priority | Surface | Required follow-up |
|---|---|---|---|
| UX-P01 | High audit priority | Admin tables/forms | Test 360/390/tablet/laptop widths, horizontal table scrolling, sticky context, action reachability, confirmation dialogs, AAL1 read-only state, and AAL2 mutation state. |
| UX-P02 | High audit priority | Payments & Wallet | Test request cards, assigned-address copy row, proof fields, incoming authorizations, ledger/withdrawal tables, inline errors, and busy states across widths. |
| UX-P03 | High audit priority | KYC | Test long filenames, replacement controls, real upload progress, aggregate-size error, rejected note, resubmission, focus recovery, and screen-reader announcements. |
| UX-P04 | Medium audit priority | Account Security/MFA | Test QR sizing, long secret wrapping, code input, recovery/failure states, keyboard order, and mobile overflow. |
| UX-P05 | Medium audit priority | Participant dashboard | Test metric cards, notifications, slot history, long localized numbers, empty/error states, and navigation at every target width. |
| UX-P06 | Medium audit priority | Treasury exposure | Replace or supplement raw JSON exposure output with an accessible structured presentation only after the owner approves the UI/UX work; do not change calculations. |
| UX-P07 | Medium audit priority | Focus visibility | Complete keyboard-only traversal on every signed-in surface and capture focus-ring contrast evidence. |
| UX-P08 | Medium audit priority | Accessible status semantics | Exercise real pending/held/approved/rejected/error transitions with a screen reader; source contracts alone are insufficient. |

## Items corrected because they affected function/security

The following are not deferred visual redesigns:

- Private upload copy and validation now use a 4 MB aggregate-compatible ceiling so accepted inputs reach Vercel Functions.
- Binance transaction input now exposes the canonical EVM format constraint while the route/database remain authoritative.
- Expired payment proof returns a readable inline conflict and removes the newly uploaded object.
- Payment mutation retries reuse logical-operation idempotency keys until success.

## Constraints for the future UI/UX audit

- Do not expose internal Binance wallet inventory, capacity, priority, reservations, or rotation.
- Do not make championship cycle client-editable.
- Do not turn User Wallet authorization into a general transfer.
- Preserve inline expected-error handling; no full-page crash for normal review/payment failures.
- Preserve exact financial amounts and server-side validation.
- Never display full private-document paths, full wallet addresses in general lists, access tokens, recovery credentials, or raw provider/database errors.
