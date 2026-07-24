-- Welfrise closed-pilot authorization and financial-integrity hardening.
-- Removes a broad profile-update path, requires AAL2 for administrative access
-- to private objects, and makes payment/withdrawal state changes fail closed.
-- This migration does not change payout, FIFO, referral, wallet-authorization,
-- KYC-status, withdrawal-fee, or championship rules.

-- The production admin surface and Server Actions admit the admin role only.
-- Match the database authorization helper to that boundary so finance and
-- compliance labels cannot invoke all administrative RPCs directly.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth, extensions, pg_temp
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
  );
$$;

-- Profile fields managed by server-side workflows must not be directly writable
-- through PostgREST. Participants retain access to the two editable profile fields.
drop policy if exists profiles_admin_update on public.profiles;
revoke update on public.profiles from authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

-- KYC metadata is written only through submit_kyc_metadata_v2 and reviewed only
-- through the AAL2 review RPC. This prevents direct table writes from bypassing
-- the route's file-content validation and submission-state checks.
revoke insert, update on public.kyc_submissions from authenticated;

-- Keep private uploads below the Vercel Function request ceiling.
update storage.buckets
set file_size_limit = 4000000
where id = 'welfrise-private';

-- Owners may manage their own private objects. Administrative access additionally
-- requires the same AAL2 boundary enforced by the admin Server Actions and RPCs.
drop policy if exists welfrise_storage_read_own_or_admin on storage.objects;
create policy welfrise_storage_read_own_or_admin on storage.objects
  for select to authenticated
  using (
    bucket_id = 'welfrise-private'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or (
        public.is_admin()
        and coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'
      )
    )
  );

drop policy if exists welfrise_storage_delete_own_or_admin on storage.objects;
create policy welfrise_storage_delete_own_or_admin on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'welfrise-private'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or (
        public.is_admin()
        and coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'
      )
    )
  );

-- Returning an expired state, instead of raising after the updates, allows the
-- reservation release and request expiry to commit atomically.
create or replace function public.submit_binance_payment(
  p_request_id uuid,
  p_tx_hash text,
  p_proof_path text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, auth, extensions, pg_temp
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
    set reserved_amount = greatest(0, reserved_amount - v_request.reserved_amount),
        updated_at = now()
    where id = v_request.receiving_wallet_id;

    update public.binance_payment_requests
    set status = 'expired', reserved_amount = 0
    where id = p_request_id;

    return 'expired';
  end if;

  if p_tx_hash is null or p_tx_hash !~ '^0x[0-9a-fA-F]{64}$' then
    raise exception 'Invalid transaction hash';
  end if;
  if coalesce(p_proof_path, '') = '' then raise exception 'Payment proof is required'; end if;

  update public.binance_payment_requests
  set tx_hash = lower(trim(p_tx_hash)),
      proof_path = p_proof_path,
      status = 'submitted',
      submitted_at = now()
  where id = p_request_id;

  return 'submitted';
end;
$$;

-- A payout reference identifies exactly one completed withdrawal, irrespective
-- of letter casing.
create unique index if not exists withdrawals_payout_tx_hash_ci_unique
  on public.withdrawals (lower(payout_tx_hash))
  where payout_tx_hash is not null;

create or replace function public.review_withdrawal_request(
  p_withdrawal_id uuid,
  p_decision text,
  p_payout_tx_hash text default null
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, auth, extensions, pg_temp
as $$
declare
  v_admin uuid := auth.uid();
  v_withdrawal public.withdrawals%rowtype;
  v_balance numeric;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if p_decision not in ('approve', 'hold', 'reject', 'complete') then raise exception 'Invalid decision'; end if;

  select * into v_withdrawal
  from public.withdrawals
  where id = p_withdrawal_id
  for update;

  if not found then raise exception 'Withdrawal not found'; end if;
  if v_withdrawal.status = 'completed' then return 'completed'; end if;
  if v_withdrawal.status not in ('pending', 'approved', 'held') then raise exception 'Withdrawal is not reviewable'; end if;

  if p_decision = 'hold' then
    update public.withdrawals
    set status = 'held', reviewed_at = now(), reviewed_by = v_admin
    where id = p_withdrawal_id;
    return 'held';
  elsif p_decision = 'approve' then
    update public.withdrawals
    set status = 'approved', reviewed_at = now(), reviewed_by = v_admin
    where id = p_withdrawal_id;
    return 'approved';
  elsif p_decision = 'reject' then
    update public.wallet_accounts
    set held_balance = held_balance - v_withdrawal.gross_amount,
        available_balance = available_balance + v_withdrawal.gross_amount,
        updated_at = now()
    where user_id = v_withdrawal.user_id
      and held_balance >= v_withdrawal.gross_amount
    returning available_balance into v_balance;

    if v_balance is null then
      raise exception 'Withdrawal held balance is inconsistent';
    end if;

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
    if trim(coalesce(p_payout_tx_hash, '')) !~ '^0x[0-9a-fA-F]{64}$' then
      raise exception 'A valid payout transaction hash is required to complete a withdrawal';
    end if;

    update public.wallet_accounts
    set held_balance = held_balance - v_withdrawal.gross_amount,
        updated_at = now()
    where user_id = v_withdrawal.user_id
      and held_balance >= v_withdrawal.gross_amount
    returning held_balance into v_balance;

    if v_balance is null then
      raise exception 'Withdrawal held balance is inconsistent';
    end if;

    update public.withdrawals
    set status = 'completed',
        payout_tx_hash = lower(trim(p_payout_tx_hash)),
        reviewed_at = now(),
        reviewed_by = v_admin
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
