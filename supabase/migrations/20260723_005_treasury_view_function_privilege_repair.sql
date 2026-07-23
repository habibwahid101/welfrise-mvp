-- Welfrise closed-pilot Treasury-view function privilege repair.
-- Restores authenticated execution of the read-only payout helper required
-- by public.admin_treasury_exposure after Migration 003 least-privilege revocation.
-- This migration does not modify payouts, balances, FIFO, referral, wallet,
-- KYC, withdrawal, or championship rules.

grant execute
on function public.welfrise_payout_for_level(integer)
to authenticated;
