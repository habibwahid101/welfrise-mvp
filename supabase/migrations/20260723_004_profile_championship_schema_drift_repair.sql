-- Welfrise closed-pilot profile championship schema drift repair.
-- Idempotently restores profile fields required by the member dashboard and
-- participation-cycle engine when a live database is missing part of Migration 002.
-- This migration does not change payout, FIFO, referral, wallet, or withdrawal rules.

alter table public.profiles
  add column if not exists championship_cycle integer not null default 1
    check (championship_cycle >= 1),

  add column if not exists championship_status text not null default 'active'
    check (championship_status in ('active', 'completed')),

  add column if not exists championship_completed_at timestamptz;

update public.profiles
set
  championship_cycle = coalesce(championship_cycle, 1),
  championship_status = coalesce(championship_status, 'active')
where championship_cycle is null
   or championship_status is null;
