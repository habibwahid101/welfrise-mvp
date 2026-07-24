# Welfrise MVP

**Give. Grow. Rise.**

A closed-pilot Next.js + Supabase MVP for participation payments, referral allocation, FIFO slots, wallet balances, KYC, withdrawals, and administration.

## Locked MVP rules

- Packages: $10/1 slot, $20/2, $50/5, $100/10.
- Maximum 10 active waiting slots per participant, per level.
- Level payouts: Level 1 **$20**; Level 2 $100; Level 3 $1,000; Level 4 $10,000; Level 5 $100,000.
- Option A FIFO: first slot establishes the queue head; the 11th, 21st, 31st… total slot triggers the next earliest waiting payout.
- Completing Level 5 closes that championship cycle. The next cycle starts only through a new paid Level 1 entry; there is no free re-entry.
- Referral commission: $1 per approved $10 slot, always paid to the **participant’s registered referrer**. Invalid/missing referral allocation goes to the Global Charity Fund.
- Withdrawal fee: **5% of gross**, with gross, fee, and net stored separately.
- Payment methods:
  - **Binance Wallet:** the platform internally assigns one active USDT-BEP20 receiving address. Users never see wallet labels, priorities, limits, usage, or rotation.
  - **User Wallet:** another registered user receives an Approve/Decline request. Approval deducts the wallet owner, creates slots for the participant, and pays commission to the participant’s referrer. This is not a general user-to-user transfer.

## Stack

- Next.js 16 App Router
- Supabase Auth, PostgreSQL, Row Level Security, RPC transactions, and private Storage
- Vercel deployment

## Supabase setup

Run these migrations in the Supabase SQL Editor **in order**:

1. `supabase/migrations/20260722_001_closed_pilot.sql`
2. `supabase/migrations/20260723_002_payment_wallet_engine.sql`
3. `supabase/migrations/20260723_003_security_integrity_and_admin_repair.sql`
4. `supabase/migrations/20260723_004_profile_championship_schema_drift_repair.sql`
5. `supabase/migrations/20260723_005_treasury_view_function_privilege_repair.sql`
6. `supabase/migrations/20260724_006_authorization_and_financial_integrity_hardening.sql`
7. `supabase/migrations/20260724_007_pilot_invitation_management.sql`

Register the owner account, then promote it:

```sql
update public.profiles
set role = 'admin'
where email = 'YOUR_OWNER_EMAIL';
```

In the Welfrise Admin page:

1. Add one or more USDT-BEP20 receiving wallets.
2. Set each internal capacity, such as `$10,000`, and priority.
3. Use controlled pilot wallet adjustments only with a clear audit reason.

Create a one-time pilot invitation in the SQL Editor (replace both placeholders):

```sql
insert into public.pilot_invitations(email, code_hash, expires_at, created_by)
select lower('INVITED_EMAIL'), extensions.crypt('ONE_TIME_CODE', extensions.gen_salt('bf')), now() + interval '7 days', id
from public.profiles where email = 'YOUR_OWNER_EMAIL' and role = 'admin';
```

## Local environment

Copy `.env.example` to `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
```

Never commit `.env.local`, database passwords, service-role keys, or Supabase secret keys.

```bash
npm ci
npm run verify
npm run lint
npm run typecheck
npm run test
npm run test:integration
npm run test:e2e
npm run build
npm run dev
```

Open:

- `/` — public closed-pilot home
- `/app` — private member dashboard
- `/app/payments` — server-controlled payments, wallet approvals, slots, ledger, and withdrawals
- `/app/kyc` — private KYC submission and review status
- `/account/security` — password and TOTP MFA
- `/admin` — receiving wallets, payment review, wallet credits, KYC, and withdrawals
- `/api/health` — deployment health

## Vercel deployment

1. Push this project to the private `welfrise-mvp` GitHub repository.
2. Import that repository into Vercel as project `welfrise`.
3. Add both Supabase environment variables to Development, Preview, and Production.
4. In Supabase Auth URL Configuration, set the Vercel production URL as the Site URL and add:

```text
https://YOUR_VERCEL_DOMAIN/auth/callback
```

5. Deploy and run the closed-pilot acceptance flow.

## Required pilot acceptance flow

1. Register User A with no referrer.
2. Register User B using User A’s referral code.
3. Register User C and add a controlled admin pilot wallet credit.
4. User B requests a Level 1 payment from User C’s wallet.
5. User C approves: C is debited, B receives the slot, A receives the referral commission.
6. Add multiple receiving wallets and verify that new Binance requests move internally when the first wallet lacks capacity; each user sees only one assigned address.
7. Submit and approve Binance proof; confirm slot, allocations, and referral commission.
8. Confirm the 11th Level 1 slot completes the earliest waiting slot and credits **$20**.
9. Approve KYC and request a $100 withdrawal; confirm $5 fee and $95 net.
10. Reject a withdrawal and confirm the held gross amount returns to available balance.

## Operational readiness boundary

- Apply migrations **001 through 007 in order**. Migration 003 repairs the pgcrypto referral generator, adds invite controls, idempotency, expiry, AAL2 admin authorization, private KYC metadata writes, immutable history protections, blockchain review fields, and the read-only treasury exposure summary. Migration 004 idempotently restores the profile championship fields required by the member dashboard and participation-cycle engine. Migration 005 restores only the read-only helper permission required by the admin Treasury exposure view. Migration 006 removes the broad profile-update path, requires AAL2 for administrative private-object access, aligns private uploads with the production request limit, and makes expired-payment and withdrawal-hold handling fail closed. Migration 007 adds AAL2-only, audited, idempotent pilot invitation creation and revocation while storing only invitation-code hashes.
- Vercel requires only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; never place a service-role key in browser or Vercel public variables.
- Set the Supabase Auth Site URL to the production Vercel origin and allow `https://YOUR_VERCEL_DOMAIN/auth/callback` as a redirect URL.
- Admin financial and KYC mutations require a verified TOTP factor and an `aal2` session. Configure the verified BEP20 chain ID, USDT contract, and minimum confirmations in `payment_network_config` before any Binance approval; no token contract is hardcoded.
- This remains an invitation-only **closed pilot**. The `/admin` treasury summary is exposure reporting, not evidence of sufficient funding.
- Supabase Free projects require a manual database backup routine. Private Storage objects are not included in a database dump and require a separate encrypted backup/export process.
- Public real-money launch remains blocked pending owner-approved treasury funding, legal/regulatory approval, independent security review, and operational reconciliation approval. The higher-level payout schedule has not been proven sustainable against the $4.50-per-$10 Level Bonus Reserve.
