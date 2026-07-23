-- Welfrise closed-pilot security, integrity, and operational repair.
-- Idempotent over migrations 001 and 002. This does not authorize public launch.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
do $$
begin
  if exists (
    select 1 from pg_catalog.pg_extension e
    join pg_catalog.pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'pgcrypto' and n.nspname <> 'extensions'
  ) then alter extension pgcrypto set schema extensions;
  end if;
end;
$$;

create or replace function public.generate_referral_code()
returns text
language plpgsql
set search_path = public, extensions, pg_temp
as $$
declare result text;
begin
  loop
    result := upper(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 8));
    exit when not exists (select 1 from public.profiles where referral_code = result);
  end loop;
  return result;
end;
$$;

-- Closed-pilot invitations. Store only slow password hashes of invitation codes.
create table if not exists public.pilot_invitations (
  id uuid primary key default extensions.gen_random_uuid(),
  email text,
  code_hash text not null,
  expires_at timestamptz not null,
  created_by uuid references public.profiles(id),
  used_by uuid references auth.users(id),
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.pilot_invitations enable row level security;
drop policy if exists pilot_invitations_admin_read on public.pilot_invitations;
create policy pilot_invitations_admin_read on public.pilot_invitations for select to authenticated using (public.is_admin());
revoke all on public.pilot_invitations from public, anon, authenticated;
grant select on public.pilot_invitations to authenticated;
create index if not exists pilot_invitations_active_idx on public.pilot_invitations(expires_at) where used_at is null and revoked_at is null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth, extensions, pg_temp
as $$
declare
  v_referral_code text;
  v_referrer uuid;
  v_invite_code text;
  v_invitation_id uuid;
begin
  if tg_op = 'INSERT' and new.invited_at is null then
    v_invite_code := nullif(trim(new.raw_user_meta_data->>'pilot_invite_code'), '');
    if v_invite_code is null then raise exception 'Pilot invitation required'; end if;
    select i.id into v_invitation_id
    from public.pilot_invitations i
    where i.used_at is null and i.revoked_at is null and i.expires_at > now()
      and (i.email is null or lower(i.email) = lower(coalesce(new.email, '')))
      and extensions.crypt(v_invite_code, i.code_hash) = i.code_hash
    order by i.created_at, i.id
    for update skip locked limit 1;
    if v_invitation_id is null then raise exception 'Pilot invitation invalid or expired'; end if;
  end if;

  v_referral_code := nullif(upper(trim(new.raw_user_meta_data->>'referral_code_used')), '');
  if v_referral_code is not null then
    select id into v_referrer from public.profiles where referral_code = v_referral_code limit 1;
  end if;
  insert into public.profiles(id,email,full_name,phone,referral_code_used,referred_by)
  values (new.id,coalesce(new.email,''),nullif(new.raw_user_meta_data->>'full_name',''),nullif(new.raw_user_meta_data->>'phone',''),v_referral_code,case when v_referrer is distinct from new.id then v_referrer end)
  on conflict (id) do update set
    email=excluded.email,
    full_name=coalesce(excluded.full_name,public.profiles.full_name),
    phone=coalesce(excluded.phone,public.profiles.phone),
    referral_code_used=coalesce(public.profiles.referral_code_used,excluded.referral_code_used),
    referred_by=coalesce(public.profiles.referred_by,excluded.referred_by),
    updated_at=now();
  if v_invitation_id is not null then
    update public.pilot_invitations set used_by=new.id,used_at=now() where id=v_invitation_id and used_at is null;
  end if;
  return new;
end;
$$;

-- Distributed rate limiting. Authenticated callers are always keyed by auth.uid().
create table if not exists public.rate_limit_windows (
  scope text not null,
  actor_key text not null,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  primary key (scope,actor_key,window_started_at)
);
alter table public.rate_limit_windows enable row level security;
revoke all on public.rate_limit_windows from public, anon, authenticated;
create index if not exists rate_limit_windows_cleanup_idx on public.rate_limit_windows(window_started_at);

create or replace function public.welfrise_check_rate_limit(p_scope text,p_actor_key text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_limit integer;
  v_seconds integer;
  v_key text;
  v_window timestamptz;
  v_count integer;
begin
  select x.max_requests,x.window_seconds into v_limit,v_seconds from (values
    ('login',8,900),('register',4,3600),('payment_create',12,300),('authorization',20,300),
    ('proof_upload',8,600),('withdrawal',6,3600),('kyc_upload',5,3600)
  ) as x(scope,max_requests,window_seconds) where x.scope=p_scope;
  if v_limit is null then raise exception 'Invalid rate limit scope'; end if;
  v_key := coalesce(auth.uid()::text,nullif(left(p_actor_key,128),''));
  if v_key is null then raise exception 'Rate limit actor required'; end if;
  v_window := to_timestamp(floor(extract(epoch from now())/v_seconds)*v_seconds);
  insert into public.rate_limit_windows(scope,actor_key,window_started_at,request_count)
  values(p_scope,v_key,v_window,1)
  on conflict(scope,actor_key,window_started_at) do update set request_count=public.rate_limit_windows.request_count+1
  returning request_count into v_count;
  delete from public.rate_limit_windows where window_started_at < now()-interval '2 days';
  return v_count <= v_limit;
end;
$$;

-- Receiving-wallet normalization, uniqueness, deterministic ordering, and request idempotency.
update public.receiving_wallets set wallet_address=lower(trim(wallet_address)),token=upper(trim(token)),network=upper(trim(network));
do $$
declare
  v_duplicate record;
  v_confirmed numeric;
  v_reserved numeric;
  v_capacity numeric;
  v_priority integer;
  v_status text;
begin
  for v_duplicate in
    select upper(network) as network_key,lower(wallet_address) as address_key,(array_agg(id order by created_at,id))[1] as keeper_id
    from public.receiving_wallets group by upper(network),lower(wallet_address) having count(*)>1
  loop
    select sum(confirmed_amount),sum(reserved_amount),max(capacity_limit),min(priority),
      case when bool_or(status='active') then 'active' when bool_or(status='paused') then 'paused' else 'disabled' end
    into v_confirmed,v_reserved,v_capacity,v_priority,v_status
    from public.receiving_wallets where upper(network)=v_duplicate.network_key and lower(wallet_address)=v_duplicate.address_key;
    update public.binance_payment_requests set receiving_wallet_id=v_duplicate.keeper_id
    where receiving_wallet_id in(select id from public.receiving_wallets where upper(network)=v_duplicate.network_key and lower(wallet_address)=v_duplicate.address_key and id<>v_duplicate.keeper_id);
    update public.receiving_wallets set confirmed_amount=v_confirmed,reserved_amount=v_reserved,
      capacity_limit=greatest(v_capacity,v_confirmed+v_reserved),priority=v_priority,status=v_status,updated_at=now()
    where id=v_duplicate.keeper_id;
    delete from public.receiving_wallets where upper(network)=v_duplicate.network_key and lower(wallet_address)=v_duplicate.address_key and id<>v_duplicate.keeper_id;
  end loop;
end $$;
alter table public.receiving_wallets drop constraint if exists receiving_wallets_network_wallet_address_key;
create unique index if not exists receiving_wallets_network_address_ci_unique on public.receiving_wallets(upper(network),lower(wallet_address));
do $$ begin
  if not exists(select 1 from pg_constraint where conname='receiving_wallet_label_length') then
    alter table public.receiving_wallets add constraint receiving_wallet_label_length check (char_length(trim(internal_label)) between 2 and 80) not valid;
    alter table public.receiving_wallets validate constraint receiving_wallet_label_length;
  end if;
  if not exists(select 1 from pg_constraint where conname='receiving_wallet_bep20_address') then
    alter table public.receiving_wallets add constraint receiving_wallet_bep20_address check (network <> 'BEP20' or wallet_address ~ '^0x[0-9a-f]{40}$') not valid;
    alter table public.receiving_wallets validate constraint receiving_wallet_bep20_address;
  end if;
end $$;

alter table public.binance_payment_requests
  add column if not exists idempotency_key text,
  add column if not exists proof_idempotency_key text,
  add column if not exists last_review_idempotency_key text,
  add column if not exists chain_id text,
  add column if not exists expected_token_contract text,
  add column if not exists expected_receiving_address text,
  add column if not exists expected_amount numeric(18,8),
  add column if not exists verified_amount numeric(18,8),
  add column if not exists verified_receiving_address text,
  add column if not exists transaction_success boolean,
  add column if not exists block_number bigint,
  add column if not exists confirmation_count integer,
  add column if not exists verification_source text,
  add column if not exists verified_at timestamptz,
  add column if not exists verification_method text;
alter table public.wallet_payment_requests add column if not exists idempotency_key text, add column if not exists response_idempotency_key text;
alter table public.withdrawals add column if not exists idempotency_key text, add column if not exists last_review_idempotency_key text;
create unique index if not exists binance_request_idempotency_unique on public.binance_payment_requests(participant_id,idempotency_key) where idempotency_key is not null;
create unique index if not exists binance_proof_idempotency_unique on public.binance_payment_requests(participant_id,proof_idempotency_key) where proof_idempotency_key is not null;
create unique index if not exists wallet_request_idempotency_unique on public.wallet_payment_requests(participant_id,idempotency_key) where idempotency_key is not null;
create unique index if not exists withdrawal_idempotency_unique on public.withdrawals(user_id,idempotency_key) where idempotency_key is not null;
create index if not exists binance_pending_expiry_idx on public.binance_payment_requests(expires_at) where status='awaiting_payment';
create index if not exists wallet_pending_expiry_idx on public.wallet_payment_requests(expires_at) where status='pending';
create index if not exists binance_review_pending_idx on public.binance_payment_requests(created_at) where status in ('submitted','held');
create index if not exists withdrawal_review_pending_idx on public.withdrawals(created_at) where status in ('pending','approved','held');
create unique index if not exists contributions_tx_hash_ci_unique on public.contributions(lower(tx_hash));

create table if not exists public.payment_network_config (
  network text not null,
  token text not null,
  chain_id text,
  token_contract text,
  minimum_confirmations integer not null default 1 check (minimum_confirmations > 0),
  enabled boolean not null default false,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key(network,token)
);
insert into public.payment_network_config(network,token,enabled) values('BEP20','USDT',false) on conflict(network,token) do nothing;
alter table public.payment_network_config enable row level security;
drop policy if exists payment_network_config_admin_read on public.payment_network_config;
create policy payment_network_config_admin_read on public.payment_network_config for select to authenticated using(public.is_admin());
revoke all on public.payment_network_config from public,anon,authenticated;
grant select on public.payment_network_config to authenticated;

create or replace function public.welfrise_set_payment_expectations()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare v_config public.payment_network_config%rowtype;
begin
  select * into v_config from public.payment_network_config where network=new.network and token=new.token;
  new.expected_receiving_address:=lower(new.assigned_wallet_address);
  new.expected_amount:=new.amount;
  new.chain_id:=v_config.chain_id;
  new.expected_token_contract:=lower(v_config.token_contract);
  return new;
end $$;
drop trigger if exists binance_payment_expectations on public.binance_payment_requests;
create trigger binance_payment_expectations before insert on public.binance_payment_requests for each row execute procedure public.welfrise_set_payment_expectations();
update public.binance_payment_requests b set expected_receiving_address=lower(b.assigned_wallet_address),expected_amount=b.amount,
  chain_id=coalesce(b.chain_id,c.chain_id),expected_token_contract=coalesce(b.expected_token_contract,lower(c.token_contract))
from public.payment_network_config c where c.network=b.network and c.token=b.token;

create table if not exists public.admin_mutation_keys (
  admin_id uuid not null references public.profiles(id), scope text not null, idempotency_key text not null,
  result text not null, created_at timestamptz not null default now(), primary key(admin_id,scope,idempotency_key)
);
alter table public.admin_mutation_keys enable row level security;
revoke all on public.admin_mutation_keys from public,anon,authenticated;

create or replace function public.welfrise_require_admin_aal2()
returns void language plpgsql stable security definer
set search_path = pg_catalog, public, auth, extensions, pg_temp
as $$ begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if coalesce(auth.jwt()->>'aal','aal1') <> 'aal2' then raise exception 'Admin MFA required'; end if;
end $$;

create or replace function public.welfrise_registered_referrer_display()
returns text language sql stable security definer set search_path=pg_catalog,public,auth,extensions,pg_temp
as $$
  select coalesce(nullif(r.full_name,''),r.referral_code)
  from public.profiles p join public.profiles r on r.id=p.referred_by
  where p.id=auth.uid() and r.account_status='active' limit 1
$$;

create or replace function public.create_binance_payment_request_v2(p_amount numeric,p_slots integer,p_level integer,p_idempotency_key text)
returns table(request_id uuid,wallet_address text,token text,network text,amount numeric,expires_at timestamptz)
language plpgsql security definer set search_path=pg_catalog,public,auth,extensions,pg_temp
as $$
declare v_existing public.binance_payment_requests%rowtype; v_created record;
begin
  if auth.uid() is null then raise exception 'Unauthorized'; end if;
  if length(trim(coalesce(p_idempotency_key,''))) < 8 then raise exception 'Invalid idempotency key'; end if;
  select * into v_existing from public.binance_payment_requests where participant_id=auth.uid() and idempotency_key=p_idempotency_key;
  if found then return query select v_existing.id,v_existing.assigned_wallet_address,v_existing.token,v_existing.network,v_existing.amount,v_existing.expires_at; return; end if;
  select * into v_created from public.create_binance_payment_request(p_amount,p_slots,p_level);
  update public.binance_payment_requests set idempotency_key=p_idempotency_key where id=v_created.request_id;
  return query select v_created.request_id,v_created.wallet_address,v_created.token,v_created.network,v_created.amount,v_created.expires_at;
end $$;

create or replace function public.create_user_wallet_payment_request_v2(p_payer_identifier text,p_amount numeric,p_slots integer,p_level integer,p_idempotency_key text)
returns table(request_id uuid,request_status text,request_expires_at timestamptz,payer_display text)
language plpgsql security definer set search_path=pg_catalog,public,auth,extensions,pg_temp
as $$
declare v_existing public.wallet_payment_requests%rowtype; v_created record;
begin
  if auth.uid() is null then raise exception 'Unauthorized'; end if;
  if length(trim(coalesce(p_idempotency_key,''))) < 8 then raise exception 'Invalid idempotency key'; end if;
  select * into v_existing from public.wallet_payment_requests where participant_id=auth.uid() and idempotency_key=p_idempotency_key;
  if found then return query select v_existing.id,v_existing.status,v_existing.expires_at,v_existing.payer_display; return; end if;
  select * into v_created from public.create_user_wallet_payment_request(p_payer_identifier,p_amount,p_slots,p_level);
  update public.wallet_payment_requests set idempotency_key=p_idempotency_key where id=v_created.request_id;
  return query select v_created.request_id,v_created.request_status,v_created.request_expires_at,v_created.payer_display;
end $$;

create or replace function public.submit_binance_payment_v2(p_request_id uuid,p_tx_hash text,p_proof_path text,p_idempotency_key text)
returns text language plpgsql security definer set search_path=pg_catalog,public,auth,extensions,pg_temp
as $$ declare v_request public.binance_payment_requests%rowtype; v_result text;
begin
  if auth.uid() is null then raise exception 'Unauthorized'; end if;
  select * into v_request from public.binance_payment_requests where id=p_request_id and participant_id=auth.uid() for update;
  if not found then raise exception 'Payment request not found'; end if;
  if v_request.proof_idempotency_key=p_idempotency_key and v_request.status in ('submitted','held','completed') then return v_request.status; end if;
  if p_proof_path not like auth.uid()::text||'/payments/'||p_request_id::text||'/%' then raise exception 'Invalid payment proof path'; end if;
  v_result:=public.submit_binance_payment(p_request_id,p_tx_hash,p_proof_path);
  update public.binance_payment_requests set proof_idempotency_key=p_idempotency_key where id=p_request_id;
  return v_result;
end $$;

create or replace function public.respond_user_wallet_payment_request_v2(p_request_id uuid,p_decision text,p_idempotency_key text)
returns text language plpgsql security definer set search_path=pg_catalog,public,auth,extensions,pg_temp
as $$ declare v_request public.wallet_payment_requests%rowtype; v_result text;
begin
  if auth.uid() is null then raise exception 'Unauthorized'; end if;
  select * into v_request from public.wallet_payment_requests where id=p_request_id and payer_id=auth.uid() for update;
  if not found then raise exception 'Authorization request not found'; end if;
  if v_request.response_idempotency_key=p_idempotency_key then return v_request.status; end if;
  v_result:=public.respond_user_wallet_payment_request(p_request_id,p_decision);
  update public.wallet_payment_requests set response_idempotency_key=p_idempotency_key where id=p_request_id;
  return v_result;
end $$;

create or replace function public.create_withdrawal_request_v2(p_gross_amount numeric,p_wallet_address text,p_idempotency_key text)
returns table(withdrawal_id uuid,gross_amount numeric,fee_amount numeric,net_amount numeric,status text)
language plpgsql security definer set search_path=pg_catalog,public,auth,extensions,pg_temp
as $$ declare v_existing public.withdrawals%rowtype; v_created record;
begin
  if auth.uid() is null then raise exception 'Unauthorized'; end if;
  if length(trim(coalesce(p_idempotency_key,''))) < 8 then raise exception 'Invalid idempotency key'; end if;
  select * into v_existing from public.withdrawals where user_id=auth.uid() and idempotency_key=p_idempotency_key;
  if found then return query select v_existing.id,v_existing.gross_amount,v_existing.fee_amount,v_existing.net_amount,v_existing.status; return; end if;
  select * into v_created from public.create_withdrawal_request(p_gross_amount,lower(trim(p_wallet_address)));
  update public.withdrawals set idempotency_key=p_idempotency_key,wallet_address=lower(wallet_address) where id=v_created.withdrawal_id;
  return query select v_created.withdrawal_id,v_created.gross_amount,v_created.fee_amount,v_created.net_amount,v_created.status;
end $$;

create or replace function public.submit_kyc_metadata_v2(p_submission_id uuid,p_id_document_path text,p_selfie_path text,p_address_document_path text)
returns text language plpgsql security definer set search_path=pg_catalog,public,auth,extensions,pg_temp
as $$ declare v_user uuid:=auth.uid(); v_existing public.kyc_submissions%rowtype; v_prefix text;
begin
  if v_user is null then raise exception 'Unauthorized'; end if;
  v_prefix:=v_user::text||'/kyc/'||p_submission_id::text||'/%';
  if p_id_document_path not like v_prefix or p_selfie_path not like v_prefix or p_address_document_path not like v_prefix then raise exception 'Invalid KYC document path'; end if;
  select * into v_existing from public.kyc_submissions where user_id=v_user for update;
  if found and v_existing.status <> 'rejected' then raise exception 'KYC submission is already pending or approved'; end if;
  insert into public.kyc_submissions(id,user_id,id_document_path,selfie_path,address_document_path,status,submitted_at,reviewed_at,reviewed_by,review_note)
  values(p_submission_id,v_user,p_id_document_path,p_selfie_path,p_address_document_path,'pending',now(),null,null,null)
  on conflict(user_id) do update set id_document_path=excluded.id_document_path,selfie_path=excluded.selfie_path,address_document_path=excluded.address_document_path,status='pending',submitted_at=now(),reviewed_at=null,reviewed_by=null,review_note=null;
  return 'pending';
end $$;

create or replace function public.welfrise_expire_stale_payment_requests()
returns integer language plpgsql security definer set search_path=pg_catalog,public,auth,extensions,pg_temp
as $$ declare v_count integer:=0;
begin
  v_count:=v_count+public.welfrise_release_expired_binance_requests();
  v_count:=v_count+public.welfrise_expire_wallet_payment_requests();
  return v_count;
end $$;

-- Admin AAL2 wrappers. Existing financial functions remain the single transaction source of truth.
create or replace function public.admin_create_receiving_wallet_v2(p_internal_label text,p_wallet_address text,p_capacity_limit numeric,p_priority integer,p_idempotency_key text)
returns text language plpgsql security definer set search_path=pg_catalog,public,auth,extensions,pg_temp
as $$ declare v_admin uuid:=auth.uid(); v_result uuid; v_previous text;
begin
  perform public.welfrise_require_admin_aal2();
  select result into v_previous from public.admin_mutation_keys where admin_id=v_admin and scope='receiving_wallet_create' and idempotency_key=p_idempotency_key; if found then return v_previous; end if;
  if char_length(trim(coalesce(p_internal_label,''))) not between 2 and 80 then raise exception 'Internal label must be 2-80 characters'; end if;
  if trim(p_wallet_address) !~ '^0x[0-9a-fA-F]{40}$' then raise exception 'Invalid BEP20 wallet address'; end if;
  if p_capacity_limit<=0 or p_priority<=0 or p_priority<>trunc(p_priority) then raise exception 'Invalid capacity or priority'; end if;
  v_result:=public.admin_create_receiving_wallet(trim(p_internal_label),lower(trim(p_wallet_address)),p_capacity_limit,p_priority,'USDT','BEP20');
  insert into public.admin_mutation_keys values(v_admin,'receiving_wallet_create',p_idempotency_key,v_result::text,now()); return v_result::text;
end $$;

create or replace function public.admin_set_receiving_wallet_status_v2(p_wallet_id uuid,p_status text,p_idempotency_key text)
returns text language plpgsql security definer set search_path=pg_catalog,public,auth,extensions,pg_temp
as $$ declare v_admin uuid:=auth.uid(); v_result text;
begin perform public.welfrise_require_admin_aal2(); select result into v_result from public.admin_mutation_keys where admin_id=v_admin and scope='receiving_wallet_status' and idempotency_key=p_idempotency_key; if found then return v_result; end if;
v_result:=public.admin_set_receiving_wallet_status(p_wallet_id,p_status); insert into public.admin_mutation_keys values(v_admin,'receiving_wallet_status',p_idempotency_key,v_result,now()); return v_result; end $$;

create or replace function public.admin_adjust_wallet_balance_v2(p_user_identifier text,p_amount numeric,p_reason text,p_idempotency_key text)
returns text language plpgsql security definer set search_path=pg_catalog,public,auth,extensions,pg_temp
as $$ declare v_admin uuid:=auth.uid(); v_row record; v_result text;
begin perform public.welfrise_require_admin_aal2(); select result into v_result from public.admin_mutation_keys where admin_id=v_admin and scope='wallet_adjustment' and idempotency_key=p_idempotency_key; if found then return v_result; end if;
select * into v_row from public.admin_adjust_wallet_balance(p_user_identifier,p_amount,p_reason); v_result:=v_row.user_id::text; insert into public.admin_mutation_keys values(v_admin,'wallet_adjustment',p_idempotency_key,v_result,now()); return v_result; end $$;

create or replace function public.review_kyc_submission_v2(p_submission_id uuid,p_status text,p_review_note text,p_idempotency_key text)
returns text language plpgsql security definer set search_path=pg_catalog,public,auth,extensions,pg_temp
as $$ declare v_admin uuid:=auth.uid(); v_result text; v_submission public.kyc_submissions%rowtype;
begin perform public.welfrise_require_admin_aal2(); select result into v_result from public.admin_mutation_keys where admin_id=v_admin and scope='kyc_review' and idempotency_key=p_idempotency_key; if found then return v_result; end if;
if p_status not in('pending','approved','rejected','held') then raise exception 'Invalid KYC status'; end if; select * into v_submission from public.kyc_submissions where id=p_submission_id for update; if not found then raise exception 'KYC submission not found'; end if;
update public.kyc_submissions set status=p_status,review_note=nullif(trim(p_review_note),''),reviewed_at=now(),reviewed_by=v_admin where id=p_submission_id;
insert into public.admin_audit_log(admin_id,action,entity_type,entity_id,metadata) values(v_admin,'kyc_status_updated','kyc_submission',p_submission_id::text,jsonb_build_object('status',p_status,'user_id',v_submission.user_id));
insert into public.admin_mutation_keys values(v_admin,'kyc_review',p_idempotency_key,p_status,now()); return p_status; end $$;

create or replace function public.review_withdrawal_request_v2(p_withdrawal_id uuid,p_decision text,p_payout_tx_hash text,p_idempotency_key text)
returns text language plpgsql security definer set search_path=pg_catalog,public,auth,extensions,pg_temp
as $$ declare v_admin uuid:=auth.uid(); v_result text; v_existing public.withdrawals%rowtype;
begin perform public.welfrise_require_admin_aal2(); select * into v_existing from public.withdrawals where id=p_withdrawal_id for update; if not found then raise exception 'Withdrawal not found'; end if; if v_existing.last_review_idempotency_key=p_idempotency_key then return v_existing.status; end if;
v_result:=public.review_withdrawal_request(p_withdrawal_id,p_decision,p_payout_tx_hash); update public.withdrawals set last_review_idempotency_key=p_idempotency_key where id=p_withdrawal_id; return v_result; end $$;

create or replace function public.review_binance_payment_v2(
 p_request_id uuid,p_decision text,p_note text,p_chain_id text,p_verified_token_contract text,p_verified_amount numeric,
 p_verified_receiving_address text,p_transaction_success boolean,p_block_number bigint,p_confirmation_count integer,
 p_verification_source text,p_verification_method text,p_recipient_matches boolean,p_amount_matches boolean,
 p_network_token_matches boolean,p_idempotency_key text)
returns text language plpgsql security definer set search_path=pg_catalog,public,auth,extensions,pg_temp
as $$ declare v_request public.binance_payment_requests%rowtype; v_config public.payment_network_config%rowtype; v_result text;
begin
  perform public.welfrise_require_admin_aal2();
  select * into v_request from public.binance_payment_requests where id=p_request_id for update; if not found then raise exception 'Payment request not found'; end if;
  if v_request.last_review_idempotency_key=p_idempotency_key then return v_request.status; end if;
  if p_decision='approve' then
    select * into v_config from public.payment_network_config where network=v_request.network and token=v_request.token and enabled=true;
    if not found or v_config.chain_id is null or v_config.token_contract is null then raise exception 'Verified token contract configuration is required'; end if;
    if not coalesce(p_transaction_success,false) or not coalesce(p_recipient_matches,false) or not coalesce(p_amount_matches,false) or not coalesce(p_network_token_matches,false) then raise exception 'On-chain verification checklist is incomplete'; end if;
    if p_chain_id is distinct from v_config.chain_id or lower(trim(p_verified_token_contract)) is distinct from lower(v_config.token_contract) then raise exception 'Verified network or token does not match configuration'; end if;
    if lower(trim(p_verified_receiving_address)) is distinct from lower(v_request.assigned_wallet_address) or p_verified_amount is distinct from v_request.amount then raise exception 'Verified recipient or amount does not match request'; end if;
    if coalesce(p_block_number,0)<=0 or coalesce(p_confirmation_count,0)<v_config.minimum_confirmations or length(trim(coalesce(p_verification_source,'')))<3 then raise exception 'Transaction confirmation evidence is incomplete'; end if;
    if p_verification_method not in('manual','automatic') then raise exception 'Invalid verification method'; end if;
    update public.binance_payment_requests set chain_id=p_chain_id,expected_token_contract=lower(v_config.token_contract),expected_receiving_address=lower(assigned_wallet_address),expected_amount=amount,
      verified_amount=p_verified_amount,verified_receiving_address=lower(trim(p_verified_receiving_address)),transaction_success=true,block_number=p_block_number,
      confirmation_count=p_confirmation_count,verification_source=trim(p_verification_source),verified_at=now(),verification_method=p_verification_method where id=p_request_id;
  end if;
  v_result:=public.review_binance_payment(p_request_id,p_decision,p_note);
  update public.binance_payment_requests set last_review_idempotency_key=p_idempotency_key where id=p_request_id;
  return v_result;
end $$;

-- Append-only history and completed-record protections.
revoke insert,update,delete on public.wallet_ledger,public.financial_ledger,public.payout_events,public.admin_audit_log from authenticated,anon;
revoke update,delete on public.contributions from authenticated,anon;
revoke insert,update,delete on public.kyc_submissions from authenticated,anon;
revoke update,delete on public.participation_slots from authenticated,anon;
revoke update,delete on public.binance_payment_requests,public.wallet_payment_requests from authenticated,anon;

create or replace function public.welfrise_block_history_rewrite()
returns trigger language plpgsql set search_path=pg_catalog,public,pg_temp
as $$ begin
  if current_user not in('postgres','service_role','supabase_admin') then raise exception 'Historical records are append-only'; end if;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
do $$ declare t text; begin
  foreach t in array array['wallet_ledger','financial_ledger','payout_events','admin_audit_log'] loop
    execute format('drop trigger if exists %I on public.%I','protect_'||t,t);
    execute format('create trigger %I before update or delete on public.%I for each row execute procedure public.welfrise_block_history_rewrite()','protect_'||t,t);
  end loop;
end $$;

-- Private KYC metadata writes now go only through the authorized RPC.
drop policy if exists kyc_insert_own on public.kyc_submissions;
drop policy if exists kyc_update_own_pending_or_admin on public.kyc_submissions;

create or replace view public.admin_treasury_exposure with(security_barrier=true) as
select
 coalesce((select sum(amount) from public.financial_ledger where entry_type='participation_contribution'),0)::numeric as total_confirmed_participation_receipts,
 coalesce((select sum(amount) from public.financial_ledger where entry_type in('charity_allocation','referral_to_charity')),0)::numeric as charity_allocations,
 coalesce((select sum(amount) from public.financial_ledger where entry_type='referral_commission'),0)::numeric as referral_commissions,
 coalesce((select sum(amount) from public.financial_ledger where entry_type='level_bonus_reserve'),0)::numeric as level_bonus_reserve_allocations,
 coalesce((select sum(amount) from public.financial_ledger where entry_type='platform_operations_reserve'),0)::numeric as operations_allocations,
 coalesce((select sum(available_balance) from public.wallet_accounts),0)::numeric as available_wallet_liabilities,
 coalesce((select sum(held_balance) from public.wallet_accounts),0)::numeric as held_wallet_liabilities,
 coalesce((select sum(payout_amount) from public.payout_events),0)::numeric as completed_payout_liabilities,
 coalesce((select jsonb_object_agg(level_id,jsonb_build_object('waiting_slots',waiting_slots,'nominal_payout_exposure',nominal_exposure)) from (select level_id,count(*) waiting_slots,sum(public.welfrise_payout_for_level(level_id)) nominal_exposure from public.participation_slots where status='waiting' group by level_id) q),'{}'::jsonb) as waiting_slot_exposure_by_level,
 case when coalesce((select sum(payout_amount) from public.payout_events),0)=0 then 0 else round(coalesce((select sum(amount) from public.financial_ledger where entry_type='level_bonus_reserve'),0)/nullif((select sum(payout_amount) from public.payout_events),0),4) end as reserve_coverage_ratio,
 coalesce((select sum(amount) from public.financial_ledger where entry_type='level_bonus_reserve'),0) < coalesce((select sum(payout_amount) from public.payout_events),0) as reserve_below_payout_liability
where public.is_admin();
revoke all on public.admin_treasury_exposure from public,anon;
grant select on public.admin_treasury_exposure to authenticated;

-- Explicit safe paths and least-privilege RPC exposure.
alter function public.is_admin() set search_path=pg_catalog,public,auth,extensions,pg_temp;
alter function public.ensure_wallet_account() set search_path=pg_catalog,public,auth,extensions,pg_temp;
alter function public.protect_profile_managed_fields() set search_path=pg_catalog,public,auth,extensions,pg_temp;
alter function public.welfrise_valid_referrer(uuid) set search_path=pg_catalog,public,auth,extensions,pg_temp;
alter function public.welfrise_credit_wallet(uuid,numeric,text,text,text,text,jsonb,uuid) set search_path=pg_catalog,public,auth,extensions,pg_temp;
alter function public.welfrise_debit_wallet(uuid,numeric,text,text,text,text,jsonb,uuid) set search_path=pg_catalog,public,auth,extensions,pg_temp;
alter function public.welfrise_complete_participation_payment(uuid,uuid,text,uuid,numeric,integer,integer,integer) set search_path=pg_catalog,public,auth,extensions,pg_temp;
alter function public.welfrise_release_expired_binance_requests() set search_path=pg_catalog,public,auth,extensions,pg_temp;
alter function public.welfrise_expire_wallet_payment_requests() set search_path=pg_catalog,public,auth,extensions,pg_temp;
alter function public.sync_kyc_profile_status() set search_path=pg_catalog,public,auth,extensions,pg_temp;
alter function public.block_self_role_change() set search_path=pg_catalog,public,auth,extensions,pg_temp;
alter function public.create_binance_payment_request(numeric,integer,integer,integer) set search_path=pg_catalog,public,auth,extensions,pg_temp;
alter function public.submit_binance_payment(uuid,text,text) set search_path=pg_catalog,public,auth,extensions,pg_temp;
alter function public.review_binance_payment(uuid,text,text) set search_path=pg_catalog,public,auth,extensions,pg_temp;
alter function public.create_user_wallet_payment_request(text,numeric,integer,integer,integer) set search_path=pg_catalog,public,auth,extensions,pg_temp;
alter function public.respond_user_wallet_payment_request(uuid,text) set search_path=pg_catalog,public,auth,extensions,pg_temp;
alter function public.cancel_user_wallet_payment_request(uuid) set search_path=pg_catalog,public,auth,extensions,pg_temp;
alter function public.admin_adjust_wallet_balance(text,numeric,text) set search_path=pg_catalog,public,auth,extensions,pg_temp;
alter function public.admin_create_receiving_wallet(text,text,numeric,integer,text,text) set search_path=pg_catalog,public,auth,extensions,pg_temp;
alter function public.admin_set_receiving_wallet_status(uuid,text) set search_path=pg_catalog,public,auth,extensions,pg_temp;
alter function public.create_withdrawal_request(numeric,text) set search_path=pg_catalog,public,auth,extensions,pg_temp;
alter function public.review_withdrawal_request(uuid,text,text) set search_path=pg_catalog,public,auth,extensions,pg_temp;

revoke all on all functions in schema public from public,anon,authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.welfrise_check_rate_limit(text,text) to anon,authenticated;
grant execute on function public.welfrise_expire_stale_payment_requests() to authenticated;
grant execute on function public.welfrise_registered_referrer_display() to authenticated;
grant execute on function public.create_binance_payment_request_v2(numeric,integer,integer,text) to authenticated;
grant execute on function public.create_user_wallet_payment_request_v2(text,numeric,integer,integer,text) to authenticated;
grant execute on function public.submit_binance_payment_v2(uuid,text,text,text) to authenticated;
grant execute on function public.respond_user_wallet_payment_request_v2(uuid,text,text) to authenticated;
grant execute on function public.cancel_user_wallet_payment_request(uuid) to authenticated;
grant execute on function public.create_withdrawal_request_v2(numeric,text,text) to authenticated;
grant execute on function public.submit_kyc_metadata_v2(uuid,text,text,text) to authenticated;
grant execute on function public.admin_create_receiving_wallet_v2(text,text,numeric,integer,text) to authenticated;
grant execute on function public.admin_set_receiving_wallet_status_v2(uuid,text,text) to authenticated;
grant execute on function public.admin_adjust_wallet_balance_v2(text,numeric,text,text) to authenticated;
grant execute on function public.review_kyc_submission_v2(uuid,text,text,text) to authenticated;
grant execute on function public.review_withdrawal_request_v2(uuid,text,text,text) to authenticated;
grant execute on function public.review_binance_payment_v2(uuid,text,text,text,text,numeric,text,boolean,bigint,integer,text,text,boolean,boolean,boolean,text) to authenticated;

-- Schedule expiration where pg_cron is available; authenticated server activity is the fallback.
do $$ begin
  begin create extension if not exists pg_cron; exception when others then raise notice 'pg_cron unavailable; server-activity fallback remains enabled'; end;
  if exists(select 1 from pg_catalog.pg_namespace where nspname='cron') then
    begin perform cron.unschedule('welfrise-expire-payment-requests'); exception when others then null; end;
    perform cron.schedule('welfrise-expire-payment-requests','*/5 * * * *','select public.welfrise_expire_stale_payment_requests();');
  end if;
end $$;
