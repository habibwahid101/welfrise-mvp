-- Welfrise closed-pilot payment and wallet engine.
-- Implements internal Binance receiving-wallet rotation, third-party authorized
-- user-wallet payments, server-owned balances, referral allocation, queue slots,
-- payouts, notifications, and withdrawal holds.
-- Closed-pilot only: not authorization for public real-money launch.

alter table public.profiles
  add column if not exists account_status text not null default 'active'
    check (account_status in ('active','held','suspended','banned')),
  add column if not exists highest_unlocked_level integer not null default 1
    check (highest_unlocked_level between 1 and 5),
  add column if not exists championship_cycle integer not null default 1
    check (championship_cycle >= 1),
  add column if not exists championship_status text not null default 'active'
    check (championship_status in ('active','completed')),
  add column if not exists championship_completed_at timestamptz;

create table if not exists public.wallet_accounts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  available_balance numeric(14,2) not null default 0 check (available_balance >= 0),
  held_balance numeric(14,2) not null default 0 check (held_balance >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.wallet_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  direction text not null check (direction in ('credit','debit')),
  amount numeric(14,2) not null check (amount >= 0),
  balance_after numeric(14,2) not null check (balance_after >= 0),
  entry_type text not null,
  reference_type text not null,
  reference_id text not null,
  description text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.receiving_wallets (
  id uuid primary key default gen_random_uuid(),
  internal_label text not null,
  wallet_address text not null,
  token text not null default 'USDT',
  network text not null default 'BEP20',
  capacity_limit numeric(14,2) not null default 10000 check (capacity_limit > 0),
  confirmed_amount numeric(14,2) not null default 0 check (confirmed_amount >= 0),
  reserved_amount numeric(14,2) not null default 0 check (reserved_amount >= 0),
  priority integer not null default 100 check (priority > 0),
  status text not null default 'active'
    check (status in ('active','paused','capacity_reached','disabled')),
  qr_image_path text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (network, wallet_address)
);

create table if not exists public.binance_payment_requests (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.profiles(id) on delete cascade,
  receiving_wallet_id uuid not null references public.receiving_wallets(id),
  assigned_wallet_address text not null,
  referrer_id uuid references public.profiles(id),
  amount numeric(12,2) not null check (amount in (10,20,50,100)),
  slots integer not null check (slots in (1,2,5,10)),
  level_id integer not null check (level_id between 1 and 5),
  championship_cycle integer not null default 1 check (championship_cycle >= 1),
  token text not null default 'USDT',
  network text not null default 'BEP20',
  reserved_amount numeric(12,2) not null check (reserved_amount >= 0),
  tx_hash text,
  proof_path text,
  status text not null default 'awaiting_payment'
    check (status in ('awaiting_payment','submitted','held','completed','rejected','expired','cancelled')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  review_note text
);

alter table public.binance_payment_requests
  add column if not exists assigned_wallet_address text;

create unique index if not exists binance_payment_tx_hash_unique
  on public.binance_payment_requests(lower(tx_hash))
  where tx_hash is not null;

create table if not exists public.wallet_payment_requests (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.profiles(id) on delete cascade,
  payer_id uuid not null references public.profiles(id) on delete cascade,
  participant_display text not null,
  payer_display text not null,
  referrer_id uuid references public.profiles(id),
  amount numeric(12,2) not null check (amount in (10,20,50,100)),
  slots integer not null check (slots in (1,2,5,10)),
  level_id integer not null check (level_id between 1 and 5),
  championship_cycle integer not null default 1 check (championship_cycle >= 1),
  status text not null default 'pending'
    check (status in ('pending','completed','declined','cancelled','expired','failed','held')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  failure_reason text
);

alter table public.wallet_payment_requests
  add column if not exists participant_display text,
  add column if not exists payer_display text;

create table if not exists public.queue_counters (
  level_id integer not null check (level_id between 1 and 5),
  championship_cycle integer not null check (championship_cycle >= 1),
  last_position bigint not null default 0 check (last_position >= 0),
  updated_at timestamptz not null default now(),
  primary key (level_id, championship_cycle)
);

create table if not exists public.participation_slots (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.profiles(id) on delete cascade,
  payer_id uuid references public.profiles(id),
  referrer_id uuid references public.profiles(id),
  payment_method text not null check (payment_method in ('binance_wallet','user_wallet','legacy_admin')),
  payment_request_id uuid not null,
  slot_index integer not null check (slot_index between 1 and 10),
  level_id integer not null check (level_id between 1 and 5),
  championship_cycle integer not null check (championship_cycle >= 1),
  level_position bigint not null check (level_position > 0),
  status text not null default 'waiting' check (status in ('waiting','completed','reversed')),
  payout_amount numeric(14,2) not null default 0 check (payout_amount >= 0),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (payment_method, payment_request_id, slot_index),
  unique (level_id, championship_cycle, level_position)
);

create table if not exists public.payout_events (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null unique references public.participation_slots(id),
  participant_id uuid not null references public.profiles(id),
  level_id integer not null check (level_id between 1 and 5),
  championship_cycle integer not null check (championship_cycle >= 1),
  payout_amount numeric(14,2) not null check (payout_amount > 0),
  trigger_position bigint not null,
  created_at timestamptz not null default now()
);

create table if not exists public.financial_ledger (
  id uuid primary key default gen_random_uuid(),
  entry_type text not null,
  amount numeric(14,2) not null check (amount >= 0),
  direction text not null default 'allocation' check (direction in ('allocation','credit','debit')),
  user_id uuid references public.profiles(id),
  participant_id uuid references public.profiles(id),
  payer_id uuid references public.profiles(id),
  slot_id uuid references public.participation_slots(id),
  reference_type text not null,
  reference_id text not null,
  description text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  notification_type text not null,
  title text not null,
  message text not null,
  reference_type text,
  reference_id text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create or replace function public.welfrise_validate_package(p_amount numeric, p_slots integer)
returns boolean
language sql
immutable
as $$
  select (p_amount = 10 and p_slots = 1)
      or (p_amount = 20 and p_slots = 2)
      or (p_amount = 50 and p_slots = 5)
      or (p_amount = 100 and p_slots = 10);
$$;

create or replace function public.welfrise_payout_for_level(p_level integer)
returns numeric
language sql
immutable
as $$
  select case p_level
    when 1 then 20::numeric
    when 2 then 100::numeric
    when 3 then 1000::numeric
    when 4 then 10000::numeric
    when 5 then 100000::numeric
    else 0::numeric
  end;
$$;

create or replace function public.ensure_wallet_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.wallet_accounts(user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists profile_wallet_account on public.profiles;
create trigger profile_wallet_account
  after insert on public.profiles
  for each row execute procedure public.ensure_wallet_account();

insert into public.wallet_accounts(user_id)
select id from public.profiles
on conflict (user_id) do nothing;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referral_code text;
  v_referrer uuid;
begin
  v_referral_code := nullif(upper(trim(new.raw_user_meta_data->>'referral_code_used')), '');
  if v_referral_code is not null then
    select id into v_referrer
    from public.profiles
    where referral_code = v_referral_code
    limit 1;
  end if;

  insert into public.profiles (
    id, email, full_name, phone, referral_code_used, referred_by
  ) values (
    new.id,
    coalesce(new.email, ''),
    nullif(new.raw_user_meta_data->>'full_name', ''),
    nullif(new.raw_user_meta_data->>'phone', ''),
    v_referral_code,
    case when v_referrer is distinct from new.id then v_referrer else null end
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    phone = coalesce(excluded.phone, public.profiles.phone),
    referral_code_used = coalesce(public.profiles.referral_code_used, excluded.referral_code_used),
    referred_by = coalesce(public.profiles.referred_by, excluded.referred_by),
    updated_at = now();
  return new;
end;
$$;

create or replace function public.protect_profile_managed_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() = old.id
    and coalesce(current_setting('welfrise.internal_profile_update', true), '') <> 'on' then
    if new.role is distinct from old.role
      or new.referral_code is distinct from old.referral_code
      or new.referred_by is distinct from old.referred_by
      or new.kyc_status is distinct from old.kyc_status
      or new.account_status is distinct from old.account_status
      or new.highest_unlocked_level is distinct from old.highest_unlocked_level
      or new.championship_cycle is distinct from old.championship_cycle
      or new.championship_status is distinct from old.championship_status
      or new.championship_completed_at is distinct from old.championship_completed_at then
      raise exception 'Managed account fields require an authorized server operation';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_protect_role on public.profiles;
drop trigger if exists profiles_protect_managed_fields on public.profiles;
create trigger profiles_protect_managed_fields
  before update on public.profiles
  for each row execute procedure public.protect_profile_managed_fields();

create or replace function public.welfrise_valid_referrer(p_participant uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select r.id
  from public.profiles p
  join public.profiles r on r.id = p.referred_by
  where p.id = p_participant
    and r.id <> p_participant
    and r.account_status = 'active'
  limit 1;
$$;

create or replace function public.welfrise_credit_wallet(
  p_user uuid,
  p_amount numeric,
  p_entry_type text,
  p_reference_type text,
  p_reference_id text,
  p_description text,
  p_metadata jsonb default '{}'::jsonb,
  p_created_by uuid default null
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric;
begin
  if p_amount <= 0 then raise exception 'Credit amount must be positive'; end if;
  insert into public.wallet_accounts(user_id) values (p_user)
  on conflict (user_id) do nothing;

  update public.wallet_accounts
  set available_balance = available_balance + p_amount,
      updated_at = now()
  where user_id = p_user
  returning available_balance into v_balance;

  insert into public.wallet_ledger(
    user_id, direction, amount, balance_after, entry_type,
    reference_type, reference_id, description, metadata, created_by
  ) values (
    p_user, 'credit', p_amount, v_balance, p_entry_type,
    p_reference_type, p_reference_id, p_description, coalesce(p_metadata, '{}'::jsonb), p_created_by
  );
  return v_balance;
end;
$$;

create or replace function public.welfrise_debit_wallet(
  p_user uuid,
  p_amount numeric,
  p_entry_type text,
  p_reference_type text,
  p_reference_id text,
  p_description text,
  p_metadata jsonb default '{}'::jsonb,
  p_created_by uuid default null
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric;
begin
  if p_amount <= 0 then raise exception 'Debit amount must be positive'; end if;

  update public.wallet_accounts
  set available_balance = available_balance - p_amount,
      updated_at = now()
  where user_id = p_user and available_balance >= p_amount
  returning available_balance into v_balance;

  if v_balance is null then raise exception 'Insufficient available balance'; end if;

  insert into public.wallet_ledger(
    user_id, direction, amount, balance_after, entry_type,
    reference_type, reference_id, description, metadata, created_by
  ) values (
    p_user, 'debit', p_amount, v_balance, p_entry_type,
    p_reference_type, p_reference_id, p_description, coalesce(p_metadata, '{}'::jsonb), p_created_by
  );
  return v_balance;
end;
$$;

create or replace function public.welfrise_complete_participation_payment(
  p_participant uuid,
  p_payer uuid,
  p_method text,
  p_request_id uuid,
  p_amount numeric,
  p_slots integer,
  p_level integer,
  p_cycle integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_referrer uuid;
  v_waiting integer;
  v_i integer;
  v_position bigint;
  v_slot_id uuid;
  v_winner public.participation_slots%rowtype;
  v_payout numeric;
  v_reference text := p_request_id::text;
begin
  if p_method not in ('binance_wallet','user_wallet','legacy_admin') then
    raise exception 'Invalid payment method';
  end if;
  if not public.welfrise_validate_package(p_amount, p_slots) then
    raise exception 'Invalid package';
  end if;
  if p_level < 1 or p_level > 5 or p_cycle < 1 then
    raise exception 'Invalid level or cycle';
  end if;
  if exists (
    select 1 from public.participation_slots
    where payment_method = p_method and payment_request_id = p_request_id
  ) then
    raise exception 'Payment request already processed';
  end if;

  select * into v_profile from public.profiles where id = p_participant for update;
  if not found or v_profile.account_status <> 'active' then
    raise exception 'Participant account is not eligible';
  end if;
  perform set_config('welfrise.internal_profile_update', 'on', true);
  if v_profile.championship_status = 'completed' then
    if p_level <> 1 or p_cycle <> v_profile.championship_cycle + 1 then
      raise exception 'A completed championship requires a new paid Level 1 entry for the next cycle';
    end if;
    update public.profiles
    set championship_cycle = p_cycle,
        championship_status = 'active',
        championship_completed_at = null,
        highest_unlocked_level = 1,
        updated_at = now()
    where id = p_participant;
    v_profile.championship_cycle := p_cycle;
    v_profile.championship_status := 'active';
    v_profile.highest_unlocked_level := 1;
  elsif p_cycle <> v_profile.championship_cycle then
    raise exception 'Payment cycle does not match the participant current championship cycle';
  end if;
  if p_level > v_profile.highest_unlocked_level then
    raise exception 'Selected level is not unlocked';
  end if;

  select count(*) into v_waiting
  from public.participation_slots
  where participant_id = p_participant
    and level_id = p_level
    and championship_cycle = p_cycle
    and status = 'waiting';
  if v_waiting + p_slots > 10 then
    raise exception 'This purchase exceeds the ten active waiting-slot limit';
  end if;

  v_referrer := public.welfrise_valid_referrer(p_participant);

  for v_i in 1..p_slots loop
    insert into public.queue_counters(level_id, championship_cycle, last_position)
    values (p_level, p_cycle, 1)
    on conflict (level_id, championship_cycle)
    do update set last_position = queue_counters.last_position + 1,
                  updated_at = now()
    returning last_position into v_position;

    insert into public.participation_slots(
      participant_id, payer_id, referrer_id, payment_method, payment_request_id,
      slot_index, level_id, championship_cycle, level_position
    ) values (
      p_participant, p_payer, v_referrer, p_method, p_request_id,
      v_i, p_level, p_cycle, v_position
    ) returning id into v_slot_id;

    insert into public.financial_ledger(
      entry_type, amount, direction, participant_id, payer_id, slot_id,
      reference_type, reference_id, description
    ) values
      ('participation_contribution', 10, 'credit', p_participant, p_payer, v_slot_id,
       p_method, v_reference, 'Approved $10 participation slot'),
      ('charity_allocation', 1, 'allocation', p_participant, p_payer, v_slot_id,
       p_method, v_reference, 'Global Charity Fund allocation'),
      ('level_bonus_reserve', 4.50, 'allocation', p_participant, p_payer, v_slot_id,
       p_method, v_reference, 'Level Bonus Reserve allocation'),
      ('platform_operations_reserve', 3.50, 'allocation', p_participant, p_payer, v_slot_id,
       p_method, v_reference, 'Platform operations and reserves allocation');

    if v_referrer is not null then
      perform public.welfrise_credit_wallet(
        v_referrer, 1, 'referral_commission', p_method, v_reference,
        'Referral commission from an approved participant slot',
        jsonb_build_object('participant_id', p_participant, 'slot_id', v_slot_id), null
      );
      insert into public.financial_ledger(
        entry_type, amount, direction, user_id, participant_id, payer_id, slot_id,
        reference_type, reference_id, description
      ) values (
        'referral_commission', 1, 'credit', v_referrer, p_participant, p_payer, v_slot_id,
        p_method, v_reference, 'Referral commission to participant registered referrer'
      );
    else
      insert into public.financial_ledger(
        entry_type, amount, direction, participant_id, payer_id, slot_id,
        reference_type, reference_id, description
      ) values (
        'referral_to_charity', 1, 'allocation', p_participant, p_payer, v_slot_id,
        p_method, v_reference, 'Referral allocation redirected to Global Charity Fund'
      );
    end if;

    if v_position > 1 and mod(v_position - 1, 10) = 0 then
      select * into v_winner
      from public.participation_slots
      where level_id = p_level
        and championship_cycle = p_cycle
        and status = 'waiting'
      order by level_position
      for update
      limit 1;

      if found then
        v_payout := public.welfrise_payout_for_level(p_level);
        update public.participation_slots
        set status = 'completed', payout_amount = v_payout, completed_at = now()
        where id = v_winner.id;

        perform public.welfrise_credit_wallet(
          v_winner.participant_id, v_payout, 'level_payout', 'payout_event', v_winner.id::text,
          format('Level %s completed-slot payout', p_level),
          jsonb_build_object('level', p_level, 'cycle', p_cycle, 'trigger_position', v_position), null
        );

        insert into public.payout_events(
          slot_id, participant_id, level_id, championship_cycle, payout_amount, trigger_position
        ) values (
          v_winner.id, v_winner.participant_id, p_level, p_cycle, v_payout, v_position
        );

        insert into public.financial_ledger(
          entry_type, amount, direction, user_id, participant_id, slot_id,
          reference_type, reference_id, description,
          metadata
        ) values (
          'level_payout', v_payout, 'credit', v_winner.participant_id,
          v_winner.participant_id, v_winner.id, 'payout_event', v_winner.id::text,
          format('Level %s payout credited', p_level),
          jsonb_build_object('trigger_position', v_position, 'championship_cycle', p_cycle)
        );

        if p_level < 5 then
          update public.profiles
          set highest_unlocked_level = greatest(highest_unlocked_level, p_level + 1),
              updated_at = now()
          where id = v_winner.participant_id
            and championship_cycle = p_cycle
            and championship_status = 'active';
        else
          update public.profiles
          set championship_status = 'completed',
              championship_completed_at = now(),
              updated_at = now()
          where id = v_winner.participant_id
            and championship_cycle = p_cycle
            and championship_status = 'active';
        end if;

        insert into public.notifications(
          user_id, notification_type, title, message, reference_type, reference_id
        ) values (
          v_winner.participant_id, 'level_payout', 'Participation payout credited',
          format('Your Level %s slot completed and $%s was credited.', p_level, v_payout),
          'participation_slot', v_winner.id::text
        );
      end if;
    end if;
  end loop;

  if v_referrer is not null then
    insert into public.notifications(
      user_id, notification_type, title, message, reference_type, reference_id
    ) values (
      v_referrer, 'referral_commission', 'Referral commission credited',
      format('$%s was credited from %s approved participant slot(s).', p_slots, p_slots),
      p_method, v_reference
    );
  end if;

  insert into public.notifications(
    user_id, notification_type, title, message, reference_type, reference_id
  ) values (
    p_participant, 'participation_completed', 'Participation confirmed',
    format('%s slot(s) were added to Level %s.', p_slots, p_level),
    p_method, v_reference
  );
  perform set_config('welfrise.internal_profile_update', 'off', true);
end;
$$;

create or replace function public.welfrise_release_expired_binance_requests()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request record;
  v_count integer := 0;
begin
  for v_request in
    select id, receiving_wallet_id, reserved_amount, participant_id
    from public.binance_payment_requests
    where status = 'awaiting_payment' and expires_at <= now()
    for update
  loop
    update public.receiving_wallets
    set reserved_amount = greatest(0, reserved_amount - v_request.reserved_amount),
        status = case
          when status = 'capacity_reached'
            and capacity_limit - confirmed_amount - greatest(0, reserved_amount - v_request.reserved_amount) >= 10
          then 'active'
          else status
        end,
        updated_at = now()
    where id = v_request.receiving_wallet_id;

    update public.binance_payment_requests
    set status = 'expired', reserved_amount = 0
    where id = v_request.id;

    insert into public.notifications(
      user_id, notification_type, title, message, reference_type, reference_id
    ) values (
      v_request.participant_id, 'payment_expired', 'Payment request expired',
      'The Binance payment request expired. Generate a new request before paying.',
      'binance_payment_request', v_request.id::text
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.create_binance_payment_request(
  p_amount numeric,
  p_slots integer,
  p_level integer,
  p_cycle integer default 1
)
returns table (
  request_id uuid,
  wallet_address text,
  token text,
  network text,
  amount numeric,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_wallet public.receiving_wallets%rowtype;
  v_request uuid;
  v_expires timestamptz := now() + interval '30 minutes';
  v_referrer uuid;
  v_profile public.profiles%rowtype;
  v_cycle integer;
begin
  if v_user is null then raise exception 'Unauthorized'; end if;
  if not public.welfrise_validate_package(p_amount, p_slots) then raise exception 'Invalid package'; end if;
  if p_level < 1 or p_level > 5 then raise exception 'Invalid level'; end if;

  perform public.welfrise_release_expired_binance_requests();
  select * into v_profile from public.profiles where id = v_user for update;
  if not found or v_profile.account_status <> 'active' then raise exception 'Account is not eligible'; end if;
  if v_profile.championship_status = 'completed' then
    if p_level <> 1 then raise exception 'Start the next championship cycle with a new paid Level 1 entry'; end if;
    v_cycle := v_profile.championship_cycle + 1;
  else
    if p_level > v_profile.highest_unlocked_level then raise exception 'Selected level is not unlocked'; end if;
    v_cycle := v_profile.championship_cycle;
  end if;
  if (select count(*) from public.participation_slots
      where participant_id = v_user and level_id = p_level
        and championship_cycle = v_cycle and status = 'waiting') + p_slots > 10 then
    raise exception 'This purchase exceeds the ten active waiting-slot limit';
  end if;
  if (select count(*) from public.binance_payment_requests
      where participant_id = v_user and status in ('awaiting_payment','submitted','held')) >= 5 then
    raise exception 'Too many active Binance payment requests';
  end if;

  select rw.* into v_wallet
  from public.receiving_wallets rw
  where rw.status = 'active'
    and rw.token = 'USDT'
    and rw.network = 'BEP20'
    and rw.capacity_limit - rw.confirmed_amount - rw.reserved_amount >= p_amount
  order by rw.priority, rw.created_at
  for update of rw skip locked
  limit 1;

  if not found then raise exception 'Binance payment is temporarily unavailable'; end if;

  update public.receiving_wallets
  set reserved_amount = reserved_amount + p_amount,
      status = case
        when capacity_limit - confirmed_amount - (reserved_amount + p_amount) < 10
        then 'capacity_reached'
        else status
      end,
      updated_at = now()
  where id = v_wallet.id;

  v_referrer := public.welfrise_valid_referrer(v_user);
  insert into public.binance_payment_requests(
    participant_id, receiving_wallet_id, assigned_wallet_address, referrer_id, amount, slots,
    level_id, championship_cycle, token, network, reserved_amount, expires_at
  ) values (
    v_user, v_wallet.id, v_wallet.wallet_address, v_referrer, p_amount, p_slots,
    p_level, v_cycle, v_wallet.token, v_wallet.network, p_amount, v_expires
  ) returning id into v_request;

  return query
  select v_request, v_wallet.wallet_address, v_wallet.token, v_wallet.network, p_amount, v_expires;
end;
$$;

create or replace function public.submit_binance_payment(
  p_request_id uuid,
  p_tx_hash text,
  p_proof_path text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.binance_payment_requests%rowtype;
begin
  if auth.uid() is null then raise exception 'Unauthorized'; end if;
  select * into v_request
  from public.binance_payment_requests
  where id = p_request_id and participant_id = auth.uid()
  for update;
  if not found then raise exception 'Payment request not found'; end if;
  if v_request.status <> 'awaiting_payment' then raise exception 'Payment request cannot be submitted'; end if;
  if v_request.expires_at <= now() then
    update public.receiving_wallets
    set reserved_amount = greatest(0, reserved_amount - v_request.reserved_amount), updated_at = now()
    where id = v_request.receiving_wallet_id;
    update public.binance_payment_requests set status = 'expired', reserved_amount = 0 where id = p_request_id;
    raise exception 'Payment request has expired';
  end if;
  if length(trim(coalesce(p_tx_hash,''))) < 10 or length(trim(p_tx_hash)) > 180 then
    raise exception 'Invalid transaction hash';
  end if;
  if coalesce(p_proof_path,'') = '' then raise exception 'Payment proof is required'; end if;

  update public.binance_payment_requests
  set tx_hash = trim(p_tx_hash), proof_path = p_proof_path,
      status = 'submitted', submitted_at = now()
  where id = p_request_id;

  return 'submitted';
end;
$$;

create or replace function public.review_binance_payment(
  p_request_id uuid,
  p_decision text,
  p_note text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_request public.binance_payment_requests%rowtype;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if p_decision not in ('approve','reject','hold') then raise exception 'Invalid decision'; end if;

  select * into v_request from public.binance_payment_requests
  where id = p_request_id for update;
  if not found then raise exception 'Payment request not found'; end if;
  if v_request.status = 'completed' then return 'completed'; end if;
  if v_request.status not in ('submitted','held') then raise exception 'Payment request is not reviewable'; end if;

  if p_decision = 'hold' then
    update public.binance_payment_requests
    set status = 'held', reviewed_at = now(), reviewed_by = v_admin, review_note = p_note
    where id = p_request_id;
    return 'held';
  end if;

  if p_decision = 'reject' then
    update public.receiving_wallets
    set reserved_amount = greatest(0, reserved_amount - v_request.reserved_amount),
        status = case
          when status = 'capacity_reached'
            and capacity_limit - confirmed_amount - greatest(0, reserved_amount - v_request.reserved_amount) >= 10
          then 'active'
          else status
        end,
        updated_at = now()
    where id = v_request.receiving_wallet_id;

    update public.binance_payment_requests
    set status = 'rejected', reserved_amount = 0, reviewed_at = now(),
        reviewed_by = v_admin, review_note = p_note
    where id = p_request_id;

    insert into public.notifications(user_id, notification_type, title, message, reference_type, reference_id)
    values (v_request.participant_id, 'payment_rejected', 'Payment declined',
      'Your Binance payment proof was declined. No slot or commission was created.',
      'binance_payment_request', p_request_id::text);
    return 'rejected';
  end if;

  if v_request.tx_hash is null or v_request.proof_path is null then
    raise exception 'Transaction hash and proof are required';
  end if;

  update public.receiving_wallets
  set reserved_amount = greatest(0, reserved_amount - v_request.reserved_amount),
      confirmed_amount = confirmed_amount + v_request.amount,
      status = case
        when capacity_limit - (confirmed_amount + v_request.amount)
             - greatest(0, reserved_amount - v_request.reserved_amount) < 10
        then 'capacity_reached'
        else 'active'
      end,
      updated_at = now()
  where id = v_request.receiving_wallet_id;

  perform public.welfrise_complete_participation_payment(
    v_request.participant_id, null, 'binance_wallet', v_request.id,
    v_request.amount, v_request.slots, v_request.level_id, v_request.championship_cycle
  );

  update public.binance_payment_requests
  set status = 'completed', reserved_amount = 0, reviewed_at = now(),
      reviewed_by = v_admin, review_note = p_note
  where id = p_request_id;

  insert into public.admin_audit_log(admin_id, action, entity_type, entity_id, metadata)
  values (v_admin, 'binance_payment_approved', 'binance_payment_request', p_request_id::text,
    jsonb_build_object('amount', v_request.amount, 'participant_id', v_request.participant_id));
  return 'completed';
end;
$$;

create or replace function public.welfrise_expire_wallet_payment_requests()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request record;
  v_count integer := 0;
begin
  for v_request in
    select id, participant_id, payer_id
    from public.wallet_payment_requests
    where status = 'pending' and expires_at <= now()
    for update
  loop
    update public.wallet_payment_requests
    set status = 'expired', responded_at = now(), failure_reason = 'Request expired'
    where id = v_request.id;

    insert into public.notifications(user_id, notification_type, title, message, reference_type, reference_id)
    values
      (v_request.participant_id, 'wallet_payment_expired', 'Wallet payment request expired',
       'The wallet authorization request expired without a deduction or slot.',
       'wallet_payment_request', v_request.id::text),
      (v_request.payer_id, 'wallet_payment_expired', 'Wallet payment request expired',
       'A pending wallet authorization request expired. No balance was deducted.',
       'wallet_payment_request', v_request.id::text);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.create_user_wallet_payment_request(
  p_payer_identifier text,
  p_amount numeric,
  p_slots integer,
  p_level integer,
  p_cycle integer default 1
)
returns table(request_id uuid, request_status text, request_expires_at timestamptz, payer_display text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_participant uuid := auth.uid();
  v_payer public.profiles%rowtype;
  v_wallet public.wallet_accounts%rowtype;
  v_request uuid;
  v_expiry timestamptz := now() + interval '24 hours';
  v_referrer uuid;
  v_profile public.profiles%rowtype;
  v_identifier text := trim(coalesce(p_payer_identifier,''));
  v_cycle integer;
begin
  if v_participant is null then raise exception 'Unauthorized'; end if;
  if not public.welfrise_validate_package(p_amount, p_slots) then raise exception 'Invalid package'; end if;
  if p_level < 1 or p_level > 5 then raise exception 'Invalid level'; end if;
  if v_identifier = '' then raise exception 'Wallet owner identifier is required'; end if;

  perform public.welfrise_expire_wallet_payment_requests();

  select * into v_profile from public.profiles where id = v_participant for update;
  if not found or v_profile.account_status <> 'active' then raise exception 'Participant account is not eligible'; end if;
  if v_profile.championship_status = 'completed' then
    if p_level <> 1 then raise exception 'Start the next championship cycle with a new paid Level 1 entry'; end if;
    v_cycle := v_profile.championship_cycle + 1;
  else
    if p_level > v_profile.highest_unlocked_level then raise exception 'Selected level is not unlocked'; end if;
    v_cycle := v_profile.championship_cycle;
  end if;
  if (select count(*) from public.participation_slots
      where participant_id = v_participant and level_id = p_level
        and championship_cycle = v_cycle and status = 'waiting') + p_slots > 10 then
    raise exception 'This purchase exceeds the ten active waiting-slot limit';
  end if;

  select * into v_payer
  from public.profiles
  where lower(email) = lower(v_identifier)
     or upper(referral_code) = upper(v_identifier)
     or id::text = v_identifier
  limit 1;
  if not found or v_payer.id = v_participant or v_payer.account_status <> 'active' then
    raise exception 'Wallet owner is not eligible or has insufficient available balance';
  end if;

  select * into v_wallet from public.wallet_accounts where user_id = v_payer.id;
  if not found or v_wallet.available_balance < p_amount then
    raise exception 'Wallet owner is not eligible or has insufficient available balance';
  end if;
  if (select count(*) from public.wallet_payment_requests
      where participant_id = v_participant and status = 'pending') >= 5 then
    raise exception 'Too many pending wallet authorization requests';
  end if;

  v_referrer := public.welfrise_valid_referrer(v_participant);
  insert into public.wallet_payment_requests(
    participant_id, payer_id, participant_display, payer_display, referrer_id, amount, slots, level_id,
    championship_cycle, expires_at
  ) values (
    v_participant, v_payer.id, coalesce(nullif(v_profile.full_name,''), v_profile.email),
    coalesce(nullif(v_payer.full_name,''), v_payer.email), v_referrer, p_amount, p_slots, p_level,
    v_cycle, v_expiry
  ) returning id into v_request;

  insert into public.notifications(user_id, notification_type, title, message, reference_type, reference_id)
  values (
    v_payer.id, 'wallet_payment_request', 'Payment authorization request',
    format('%s is requesting $%s from your Welfrise wallet for %s Level %s slot(s).',
      coalesce(v_profile.full_name, 'A participant'), p_amount, p_slots, p_level),
    'wallet_payment_request', v_request::text
  );

  return query select v_request, 'pending'::text, v_expiry,
    coalesce(nullif(v_payer.full_name,''), 'Welfrise member');
end;
$$;

create or replace function public.respond_user_wallet_payment_request(
  p_request_id uuid,
  p_decision text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payer uuid := auth.uid();
  v_request public.wallet_payment_requests%rowtype;
  v_balance numeric;
begin
  if v_payer is null then raise exception 'Unauthorized'; end if;
  if p_decision not in ('approve','decline') then raise exception 'Invalid decision'; end if;

  select * into v_request
  from public.wallet_payment_requests
  where id = p_request_id and payer_id = v_payer
  for update;
  if not found then raise exception 'Authorization request not found'; end if;
  if v_request.status = 'completed' then return 'completed'; end if;
  if v_request.status <> 'pending' then raise exception 'Authorization request is no longer pending'; end if;
  if v_request.expires_at <= now() then
    update public.wallet_payment_requests
    set status = 'expired', responded_at = now(), failure_reason = 'Request expired'
    where id = p_request_id;
    return 'expired';
  end if;

  if p_decision = 'decline' then
    update public.wallet_payment_requests
    set status = 'declined', responded_at = now()
    where id = p_request_id;
    insert into public.notifications(user_id, notification_type, title, message, reference_type, reference_id)
    values (v_request.participant_id, 'wallet_payment_declined', 'Wallet payment declined',
      'The wallet owner declined the authorization request. No balance was deducted.',
      'wallet_payment_request', p_request_id::text);
    return 'declined';
  end if;

  v_balance := public.welfrise_debit_wallet(
    v_payer, v_request.amount, 'authorized_participation_payment',
    'wallet_payment_request', p_request_id::text,
    'Authorized participation payment for another Welfrise member',
    jsonb_build_object('participant_id', v_request.participant_id, 'level', v_request.level_id), v_payer
  );

  perform public.welfrise_complete_participation_payment(
    v_request.participant_id, v_payer, 'user_wallet', v_request.id,
    v_request.amount, v_request.slots, v_request.level_id, v_request.championship_cycle
  );

  update public.wallet_payment_requests
  set status = 'completed', responded_at = now()
  where id = p_request_id;

  insert into public.notifications(user_id, notification_type, title, message, reference_type, reference_id)
  values
    (v_request.participant_id, 'wallet_payment_completed', 'Participation payment approved',
     format('The wallet owner approved $%s. Your slot(s) were created.', v_request.amount),
     'wallet_payment_request', p_request_id::text),
    (v_payer, 'wallet_payment_debited', 'Wallet payment completed',
     format('$%s was deducted. Available balance is now $%s.', v_request.amount, v_balance),
     'wallet_payment_request', p_request_id::text);
  return 'completed';
exception
  when raise_exception then
    update public.wallet_payment_requests
    set status = 'failed', responded_at = now(), failure_reason = left(sqlerrm, 240)
    where id = p_request_id and status = 'pending';
    insert into public.notifications(user_id, notification_type, title, message, reference_type, reference_id)
    select participant_id, 'wallet_payment_failed', 'Wallet payment failed',
      'The authorization could not be completed. No balance was deducted and no slot was created.',
      'wallet_payment_request', id::text
    from public.wallet_payment_requests where id = p_request_id;
    return 'failed';
end;
$$;

create or replace function public.cancel_user_wallet_payment_request(p_request_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.wallet_payment_requests%rowtype;
begin
  if auth.uid() is null then raise exception 'Unauthorized'; end if;
  select * into v_request
  from public.wallet_payment_requests
  where id = p_request_id and participant_id = auth.uid()
  for update;
  if not found then raise exception 'Authorization request not found'; end if;
  if v_request.status <> 'pending' then raise exception 'Only pending requests can be cancelled'; end if;
  update public.wallet_payment_requests
  set status = 'cancelled', responded_at = now()
  where id = p_request_id;
  insert into public.notifications(user_id, notification_type, title, message, reference_type, reference_id)
  values (v_request.payer_id, 'wallet_payment_cancelled', 'Payment request cancelled',
    'The participant cancelled the wallet authorization request.',
    'wallet_payment_request', p_request_id::text);
  return 'cancelled';
end;
$$;

create or replace function public.admin_adjust_wallet_balance(
  p_user_identifier text,
  p_amount numeric,
  p_reason text
)
returns table(user_id uuid, available_balance numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_balance numeric;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if p_amount = 0 or abs(p_amount) > 100000 then raise exception 'Invalid adjustment amount'; end if;
  if length(trim(coalesce(p_reason,''))) < 5 then raise exception 'A clear audit reason is required'; end if;

  select * into v_profile from public.profiles
  where lower(email) = lower(trim(p_user_identifier))
     or upper(referral_code) = upper(trim(p_user_identifier))
     or id::text = trim(p_user_identifier)
  limit 1;
  if not found then raise exception 'User not found'; end if;

  if p_amount > 0 then
    v_balance := public.welfrise_credit_wallet(
      v_profile.id, p_amount, 'admin_pilot_credit', 'admin_adjustment', gen_random_uuid()::text,
      p_reason, '{}'::jsonb, v_admin
    );
  else
    v_balance := public.welfrise_debit_wallet(
      v_profile.id, abs(p_amount), 'admin_pilot_debit', 'admin_adjustment', gen_random_uuid()::text,
      p_reason, '{}'::jsonb, v_admin
    );
  end if;

  insert into public.admin_audit_log(admin_id, action, entity_type, entity_id, metadata)
  values (v_admin, 'wallet_balance_adjusted', 'wallet_account', v_profile.id::text,
    jsonb_build_object('amount', p_amount, 'reason', p_reason, 'balance_after', v_balance));

  insert into public.notifications(user_id, notification_type, title, message, reference_type, reference_id)
  values (v_profile.id, 'wallet_adjustment', 'Wallet balance updated',
    format('An authorized pilot adjustment of $%s was applied. New available balance: $%s.', p_amount, v_balance),
    'wallet_account', v_profile.id::text);

  return query select v_profile.id, v_balance;
end;
$$;

create or replace function public.admin_create_receiving_wallet(
  p_internal_label text,
  p_wallet_address text,
  p_capacity_limit numeric default 10000,
  p_priority integer default 100,
  p_token text default 'USDT',
  p_network text default 'BEP20'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if length(trim(coalesce(p_internal_label,''))) < 2 then raise exception 'Internal label is required'; end if;
  if p_network = 'BEP20' and trim(p_wallet_address) !~ '^0x[0-9a-fA-F]{40}$' then
    raise exception 'Invalid BEP20 wallet address';
  end if;
  if p_capacity_limit <= 0 or p_priority <= 0 then raise exception 'Invalid capacity or priority'; end if;

  insert into public.receiving_wallets(
    internal_label, wallet_address, token, network, capacity_limit, priority, created_by
  ) values (
    trim(p_internal_label), trim(p_wallet_address), upper(trim(p_token)), upper(trim(p_network)),
    p_capacity_limit, p_priority, auth.uid()
  ) returning id into v_id;

  insert into public.admin_audit_log(admin_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'receiving_wallet_created', 'receiving_wallet', v_id::text,
    jsonb_build_object('label', p_internal_label, 'capacity_limit', p_capacity_limit, 'priority', p_priority));
  return v_id;
end;
$$;

create or replace function public.admin_set_receiving_wallet_status(
  p_wallet_id uuid,
  p_status text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if p_status not in ('active','paused','capacity_reached','disabled') then raise exception 'Invalid status'; end if;
  update public.receiving_wallets
  set status = p_status, updated_at = now()
  where id = p_wallet_id;
  if not found then raise exception 'Receiving wallet not found'; end if;
  insert into public.admin_audit_log(admin_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'receiving_wallet_status_updated', 'receiving_wallet', p_wallet_id::text,
    jsonb_build_object('status', p_status));
  return p_status;
end;
$$;

create or replace function public.create_withdrawal_request(
  p_gross_amount numeric,
  p_wallet_address text
)
returns table(
  withdrawal_id uuid,
  gross_amount numeric,
  fee_amount numeric,
  net_amount numeric,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_fee numeric(12,2);
  v_net numeric(12,2);
  v_id uuid;
  v_balance numeric;
  v_today numeric;
begin
  if v_user is null then raise exception 'Unauthorized'; end if;
  if p_gross_amount < 10 or p_gross_amount > 100 then raise exception 'Withdrawal amount must be between $10 and $100'; end if;
  if trim(p_wallet_address) !~ '^0x[0-9a-fA-F]{40}$' then raise exception 'Invalid BEP20 wallet address'; end if;

  select * into v_profile from public.profiles where id = v_user;
  if not found or v_profile.account_status <> 'active' then raise exception 'Account is not eligible'; end if;
  if v_profile.kyc_status <> 'approved' then raise exception 'Approved KYC is required before withdrawal'; end if;
  if exists (select 1 from public.withdrawals w where w.user_id = v_user and w.status in ('pending','approved','held')) then
    raise exception 'A withdrawal is already pending';
  end if;
  select coalesce(sum(w.gross_amount),0) into v_today
  from public.withdrawals w
  where w.user_id = v_user
    and w.created_at >= date_trunc('day', now())
    and w.status <> 'rejected';
  if v_today + p_gross_amount > 100 then raise exception 'Daily withdrawal limit is $100'; end if;

  v_fee := round(p_gross_amount * 0.05, 2);
  v_net := round(p_gross_amount - v_fee, 2);
  v_id := gen_random_uuid();
  v_balance := public.welfrise_debit_wallet(
    v_user, p_gross_amount, 'withdrawal_hold', 'withdrawal', v_id::text,
    'Withdrawal amount moved from available to held balance',
    jsonb_build_object('gross', p_gross_amount, 'fee', v_fee, 'net', v_net), v_user
  );

  update public.wallet_accounts
  set held_balance = held_balance + p_gross_amount, updated_at = now()
  where user_id = v_user;

  insert into public.withdrawals(
    id, user_id, gross_amount, fee_amount, net_amount, wallet_address, network, status
  ) values (
    v_id, v_user, p_gross_amount, v_fee, v_net, trim(p_wallet_address), 'BEP20', 'pending'
  );

  return query select v_id, p_gross_amount, v_fee, v_net, 'pending'::text;
end;
$$;

create or replace function public.review_withdrawal_request(
  p_withdrawal_id uuid,
  p_decision text,
  p_payout_tx_hash text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_withdrawal public.withdrawals%rowtype;
  v_balance numeric;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if p_decision not in ('approve','hold','reject','complete') then raise exception 'Invalid decision'; end if;
  select * into v_withdrawal from public.withdrawals
  where id = p_withdrawal_id for update;
  if not found then raise exception 'Withdrawal not found'; end if;
  if v_withdrawal.status = 'completed' then return 'completed'; end if;
  if v_withdrawal.status not in ('pending','approved','held') then raise exception 'Withdrawal is not reviewable'; end if;

  if p_decision = 'hold' then
    update public.withdrawals set status = 'held', reviewed_at = now(), reviewed_by = v_admin
    where id = p_withdrawal_id;
    return 'held';
  elsif p_decision = 'approve' then
    update public.withdrawals set status = 'approved', reviewed_at = now(), reviewed_by = v_admin
    where id = p_withdrawal_id;
    return 'approved';
  elsif p_decision = 'reject' then
    update public.wallet_accounts
    set held_balance = greatest(0, held_balance - v_withdrawal.gross_amount),
        available_balance = available_balance + v_withdrawal.gross_amount,
        updated_at = now()
    where user_id = v_withdrawal.user_id
    returning available_balance into v_balance;

    insert into public.wallet_ledger(
      user_id, direction, amount, balance_after, entry_type, reference_type,
      reference_id, description, created_by
    ) values (
      v_withdrawal.user_id, 'credit', v_withdrawal.gross_amount, v_balance,
      'withdrawal_released', 'withdrawal', p_withdrawal_id::text,
      'Rejected withdrawal returned to available balance', v_admin
    );

    update public.withdrawals
    set status = 'rejected', reviewed_at = now(), reviewed_by = v_admin
    where id = p_withdrawal_id;
    return 'rejected';
  else
    if length(trim(coalesce(p_payout_tx_hash,''))) < 10 then
      raise exception 'Payout transaction hash is required to complete a withdrawal';
    end if;
    update public.wallet_accounts
    set held_balance = greatest(0, held_balance - v_withdrawal.gross_amount), updated_at = now()
    where user_id = v_withdrawal.user_id;

    update public.withdrawals
    set status = 'completed', payout_tx_hash = trim(p_payout_tx_hash),
        reviewed_at = now(), reviewed_by = v_admin
    where id = p_withdrawal_id;

    insert into public.financial_ledger(
      entry_type, amount, direction, user_id, reference_type, reference_id, description
    ) values
      ('withdrawal_gross', v_withdrawal.gross_amount, 'debit', v_withdrawal.user_id,
       'withdrawal', p_withdrawal_id::text, 'Gross withdrawal completed'),
      ('withdrawal_fee', v_withdrawal.fee_amount, 'credit', null,
       'withdrawal', p_withdrawal_id::text, 'Five percent withdrawal fee'),
      ('withdrawal_net', v_withdrawal.net_amount, 'debit', v_withdrawal.user_id,
       'withdrawal', p_withdrawal_id::text, 'Net withdrawal paid to user');
    return 'completed';
  end if;
end;
$$;

create or replace function public.sync_kyc_profile_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('welfrise.internal_profile_update', 'on', true);
  update public.profiles
  set kyc_status = new.status, updated_at = now()
  where id = new.user_id;
  perform set_config('welfrise.internal_profile_update', 'off', true);
  return new;
end;
$$;

drop trigger if exists kyc_sync_profile_status on public.kyc_submissions;
create trigger kyc_sync_profile_status
  after insert or update of status on public.kyc_submissions
  for each row execute procedure public.sync_kyc_profile_status();

create or replace view public.admin_receiving_wallets
with (security_barrier = true)
as
select rw.*
from public.receiving_wallets rw
where public.is_admin();

create or replace view public.admin_binance_payment_requests
with (security_barrier = true)
as
select
  b.*,
  p.email as participant_email,
  p.full_name as participant_name,
  rw.internal_label as receiving_wallet_label,
  rw.wallet_address as receiving_wallet_address,
  rw.network as receiving_wallet_network
from public.binance_payment_requests b
join public.profiles p on p.id = b.participant_id
join public.receiving_wallets rw on rw.id = b.receiving_wallet_id
where public.is_admin();

-- Row Level Security
alter table public.wallet_accounts enable row level security;
alter table public.wallet_ledger enable row level security;
alter table public.receiving_wallets enable row level security;
alter table public.binance_payment_requests enable row level security;
alter table public.wallet_payment_requests enable row level security;
alter table public.queue_counters enable row level security;
alter table public.participation_slots enable row level security;
alter table public.payout_events enable row level security;
alter table public.financial_ledger enable row level security;
alter table public.notifications enable row level security;

drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists kyc_update_own_pending_or_admin on public.kyc_submissions;
create policy kyc_update_own_pending_or_admin on public.kyc_submissions
  for update to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (
    public.is_admin()
    or (user_id = auth.uid() and status = 'pending' and reviewed_by is null and reviewed_at is null)
  );

drop policy if exists wallet_accounts_read_own_or_admin on public.wallet_accounts;
create policy wallet_accounts_read_own_or_admin on public.wallet_accounts
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists wallet_ledger_read_own_or_admin on public.wallet_ledger;
create policy wallet_ledger_read_own_or_admin on public.wallet_ledger
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists receiving_wallets_admin_only on public.receiving_wallets;
create policy receiving_wallets_admin_only on public.receiving_wallets
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists binance_requests_read_own_or_admin on public.binance_payment_requests;
create policy binance_requests_read_own_or_admin on public.binance_payment_requests
  for select to authenticated using (participant_id = auth.uid() or public.is_admin());

drop policy if exists wallet_requests_read_parties_or_admin on public.wallet_payment_requests;
create policy wallet_requests_read_parties_or_admin on public.wallet_payment_requests
  for select to authenticated using (
    participant_id = auth.uid() or payer_id = auth.uid() or public.is_admin()
  );

drop policy if exists queue_counters_admin_read on public.queue_counters;
create policy queue_counters_admin_read on public.queue_counters
  for select to authenticated using (public.is_admin());

drop policy if exists participation_slots_read_own_or_admin on public.participation_slots;
create policy participation_slots_read_own_or_admin on public.participation_slots
  for select to authenticated using (
    participant_id = auth.uid() or payer_id = auth.uid() or public.is_admin()
  );

drop policy if exists payout_events_read_own_or_admin on public.payout_events;
create policy payout_events_read_own_or_admin on public.payout_events
  for select to authenticated using (participant_id = auth.uid() or public.is_admin());

drop policy if exists financial_ledger_read_related_or_admin on public.financial_ledger;
create policy financial_ledger_read_related_or_admin on public.financial_ledger
  for select to authenticated using (
    user_id = auth.uid() or participant_id = auth.uid() or payer_id = auth.uid() or public.is_admin()
  );

drop policy if exists notifications_owner_or_admin on public.notifications;
create policy notifications_owner_or_admin on public.notifications
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists notifications_owner_update on public.notifications;
create policy notifications_owner_update on public.notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Prevent direct access to internal receiving-wallet rotation fields.
revoke select on public.receiving_wallets from authenticated;
revoke select on public.binance_payment_requests from authenticated;

-- Prevent direct client mutation of server-owned financial tables.
revoke insert, update, delete on public.wallet_accounts from authenticated;
revoke insert, update, delete on public.wallet_ledger from authenticated;
revoke insert, update, delete on public.binance_payment_requests from authenticated;
revoke insert, update, delete on public.wallet_payment_requests from authenticated;
revoke insert, update, delete on public.queue_counters from authenticated;
revoke insert, update, delete on public.participation_slots from authenticated;
revoke insert, update, delete on public.payout_events from authenticated;
revoke insert, update, delete on public.financial_ledger from authenticated;
revoke insert, delete on public.notifications from authenticated;

grant select on public.wallet_accounts, public.wallet_ledger,
  public.wallet_payment_requests, public.queue_counters,
  public.participation_slots, public.payout_events, public.financial_ledger,
  public.notifications to authenticated;

grant select (
  id, participant_id, assigned_wallet_address, amount, slots, level_id,
  championship_cycle, token, network, tx_hash, status, expires_at,
  created_at, submitted_at, reviewed_at, review_note
) on public.binance_payment_requests to authenticated;

grant select on public.admin_receiving_wallets, public.admin_binance_payment_requests to authenticated;
grant update(is_read) on public.notifications to authenticated;

-- Direct contribution insertion is disabled; payment requests must use the assigned
-- Binance-wallet or authorized user-wallet RPC flow.
drop policy if exists contributions_insert_own on public.contributions;
revoke insert on public.contributions from authenticated;

-- Tighten withdrawal direct-write access: creation and review use RPC functions.
revoke insert, update on public.withdrawals from authenticated;
drop index if exists withdrawals_one_pending_per_user;
create unique index if not exists withdrawals_one_active_per_user
  on public.withdrawals(user_id)
  where status in ('pending','approved','held');

-- Private storage bucket for Welfrise payment proofs and KYC documents.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'welfrise-private', 'welfrise-private', false, 5000000,
  array['image/jpeg','image/png','image/webp','application/pdf']
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

-- Expose only intended RPC entry points.
revoke all on function public.welfrise_credit_wallet(uuid,numeric,text,text,text,text,jsonb,uuid) from public, anon, authenticated;
revoke all on function public.welfrise_debit_wallet(uuid,numeric,text,text,text,text,jsonb,uuid) from public, anon, authenticated;
revoke all on function public.welfrise_complete_participation_payment(uuid,uuid,text,uuid,numeric,integer,integer,integer) from public, anon, authenticated;
revoke all on function public.welfrise_valid_referrer(uuid) from public, anon;
revoke all on function public.welfrise_release_expired_binance_requests() from public, anon;
revoke all on function public.welfrise_expire_wallet_payment_requests() from public, anon;

grant execute on function public.welfrise_release_expired_binance_requests() to authenticated;
grant execute on function public.welfrise_expire_wallet_payment_requests() to authenticated;
grant execute on function public.create_binance_payment_request(numeric,integer,integer,integer) to authenticated;
grant execute on function public.submit_binance_payment(uuid,text,text) to authenticated;
grant execute on function public.review_binance_payment(uuid,text,text) to authenticated;
grant execute on function public.create_user_wallet_payment_request(text,numeric,integer,integer,integer) to authenticated;
grant execute on function public.respond_user_wallet_payment_request(uuid,text) to authenticated;
grant execute on function public.cancel_user_wallet_payment_request(uuid) to authenticated;
grant execute on function public.admin_adjust_wallet_balance(text,numeric,text) to authenticated;
grant execute on function public.admin_create_receiving_wallet(text,text,numeric,integer,text,text) to authenticated;
grant execute on function public.admin_set_receiving_wallet_status(uuid,text) to authenticated;
grant execute on function public.create_withdrawal_request(numeric,text) to authenticated;
grant execute on function public.review_withdrawal_request(uuid,text,text) to authenticated;
