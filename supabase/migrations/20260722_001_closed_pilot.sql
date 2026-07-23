-- Welfrise closed-pilot schema.
-- This migration supports authentication, state persistence, payment-proof intake,
-- KYC intake, withdrawal requests, and an admin review console.
-- It is intentionally a sandbox MVP and does not authorize real-money launch.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
do $$
begin
  if exists (
    select 1 from pg_catalog.pg_extension e
    join pg_catalog.pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'pgcrypto' and n.nspname <> 'extensions'
  ) then
    alter extension pgcrypto set schema extensions;
  end if;
end;
$$;

create or replace function public.generate_referral_code()
returns text
language plpgsql
as $$
declare
  result text;
begin
  loop
    result := upper(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 8));
    exit when not exists (select 1 from public.profiles where referral_code = result);
  end loop;
  return result;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  phone text,
  role text not null default 'user' check (role in ('user', 'admin', 'finance', 'compliance', 'support')),
  referral_code text not null default public.generate_referral_code() unique,
  referral_code_used text,
  referred_by uuid references public.profiles(id),
  kyc_status text not null default 'not_submitted' check (kyc_status in ('not_submitted', 'pending', 'approved', 'rejected', 'held')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_states (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.contributions (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null constraint contributions_user_id_fkey references public.profiles(id) on delete cascade,
  level_id integer not null check (level_id between 1 and 5),
  amount numeric(12,2) not null check (amount in (10,20,50,100)),
  slots integer not null check (slots in (1,2,5,10)),
  tx_hash text not null unique,
  proof_path text not null,
  requested_cycle integer not null default 1 check (requested_cycle >= 1),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'held', 'completed')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id)
);

create table if not exists public.withdrawals (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null constraint withdrawals_user_id_fkey references public.profiles(id) on delete cascade,
  gross_amount numeric(12,2) not null check (gross_amount >= 10 and gross_amount <= 100),
  fee_amount numeric(12,2) not null check (fee_amount >= 0),
  net_amount numeric(12,2) not null check (net_amount >= 0),
  wallet_address text not null,
  network text not null default 'BEP20',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'held', 'completed')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  payout_tx_hash text
);

create unique index if not exists withdrawals_one_pending_per_user
  on public.withdrawals(user_id)
  where status = 'pending';

create table if not exists public.kyc_submissions (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null constraint kyc_submissions_user_id_fkey references public.profiles(id) on delete cascade unique,
  id_document_path text not null,
  selfie_path text not null,
  address_document_path text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'held')),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  review_note text
);

create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  admin_id uuid not null references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'finance', 'compliance')
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, phone, referral_code_used)
  values (
    new.id,
    coalesce(new.email, ''),
    nullif(new.raw_user_meta_data->>'full_name', ''),
    nullif(new.raw_user_meta_data->>'phone', ''),
    nullif(new.raw_user_meta_data->>'referral_code_used', '')
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    phone = coalesce(excluded.phone, public.profiles.phone),
    referral_code_used = coalesce(excluded.referral_code_used, public.profiles.referral_code_used),
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update of email, raw_user_meta_data on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.block_self_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() = old.id and new.role is distinct from old.role then
    raise exception 'Role changes require a privileged server operation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_protect_role on public.profiles;
create trigger profiles_protect_role
  before update on public.profiles
  for each row execute procedure public.block_self_role_change();

alter table public.profiles enable row level security;
alter table public.app_states enable row level security;
alter table public.contributions enable row level security;
alter table public.withdrawals enable row level security;
alter table public.kyc_submissions enable row level security;
alter table public.admin_audit_log enable row level security;

drop policy if exists profiles_read_self_or_admin on public.profiles;
create policy profiles_read_self_or_admin on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists app_states_owner_all on public.app_states;
create policy app_states_owner_all on public.app_states
  for all to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

drop policy if exists contributions_insert_own on public.contributions;
create policy contributions_insert_own on public.contributions
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists contributions_read_own_or_admin on public.contributions;
create policy contributions_read_own_or_admin on public.contributions
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists contributions_admin_update on public.contributions;
create policy contributions_admin_update on public.contributions
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists withdrawals_insert_own on public.withdrawals;
create policy withdrawals_insert_own on public.withdrawals
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists withdrawals_read_own_or_admin on public.withdrawals;
create policy withdrawals_read_own_or_admin on public.withdrawals
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists withdrawals_admin_update on public.withdrawals;
create policy withdrawals_admin_update on public.withdrawals
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists kyc_insert_own on public.kyc_submissions;
create policy kyc_insert_own on public.kyc_submissions
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists kyc_update_own_pending_or_admin on public.kyc_submissions;
create policy kyc_update_own_pending_or_admin on public.kyc_submissions
  for update to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

drop policy if exists kyc_read_own_or_admin on public.kyc_submissions;
create policy kyc_read_own_or_admin on public.kyc_submissions
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists audit_admin_only on public.admin_audit_log;
create policy audit_admin_only on public.admin_audit_log
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update on public.app_states to authenticated;
grant select, insert, update on public.contributions to authenticated;
grant select, insert, update on public.withdrawals to authenticated;
grant select, insert, update on public.kyc_submissions to authenticated;
grant select, insert on public.admin_audit_log to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'welfrise-private',
  'welfrise-private',
  false,
  5000000,
  array['image/jpeg','image/png','image/webp','application/pdf','application/octet-stream']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists welfrise_storage_insert_own on storage.objects;
create policy welfrise_storage_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'welfrise-private'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists welfrise_storage_read_own_or_admin on storage.objects;
create policy welfrise_storage_read_own_or_admin on storage.objects
  for select to authenticated
  using (
    bucket_id = 'welfrise-private'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

drop policy if exists welfrise_storage_delete_own_or_admin on storage.objects;
create policy welfrise_storage_delete_own_or_admin on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'welfrise-private'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

-- After the first account is registered, promote it from the SQL Editor:
-- update public.profiles set role = 'admin' where email = 'owner@example.com';
