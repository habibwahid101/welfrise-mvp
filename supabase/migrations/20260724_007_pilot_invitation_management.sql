-- Welfrise closed-pilot invitation management.
-- Codes are generated once, returned once, and stored only as bcrypt hashes.
-- This migration does not change financial, FIFO, referral, wallet, KYC,
-- withdrawal-fee, payout, or championship rules.

create or replace function public.admin_create_pilot_invitation_v1(
  p_email text, p_expires_at timestamptz, p_idempotency_key text)
returns table(invitation_id uuid, invitation_code text)
language plpgsql security definer
set search_path=pg_catalog,public,auth,extensions,pg_temp
as $$
declare
  v_admin uuid:=auth.uid();
  v_previous text;
  v_id uuid;
  v_code text;
  v_email text:=nullif(lower(btrim(p_email)),'');
begin
  perform public.welfrise_require_admin_aal2();
  if nullif(btrim(p_idempotency_key),'') is null then raise exception 'Idempotency key is required'; end if;
  select result into v_previous from public.admin_mutation_keys
    where admin_id=v_admin and scope='pilot_invitation_create' and idempotency_key=p_idempotency_key;
  if found then return query select v_previous::uuid,null::text; return; end if;
  if v_email is not null and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Invalid email binding'; end if;
  if p_expires_at <= now() or p_expires_at > now()+interval '90 days' then raise exception 'Expiry must be within 90 days'; end if;

  v_code:='WF-'||upper(encode(extensions.gen_random_bytes(12),'hex'));
  insert into public.pilot_invitations(email,code_hash,expires_at,created_by)
  values(v_email,extensions.crypt(v_code,extensions.gen_salt('bf',12)),p_expires_at,v_admin)
  returning id into v_id;
  insert into public.admin_mutation_keys(admin_id,scope,idempotency_key,result)
  values(v_admin,'pilot_invitation_create',p_idempotency_key,v_id::text);
  insert into public.admin_audit_log(admin_id,action,entity_type,entity_id,metadata)
  values(v_admin,'pilot_invitation_created','pilot_invitation',v_id::text,jsonb_build_object('email_bound',v_email is not null,'expires_at',p_expires_at));
  return query select v_id,v_code;
end $$;

create or replace function public.admin_revoke_pilot_invitation_v1(p_invitation_id uuid,p_idempotency_key text)
returns text language plpgsql security definer
set search_path=pg_catalog,public,auth,extensions,pg_temp
as $$
declare v_admin uuid:=auth.uid(); v_previous text; v_invitation public.pilot_invitations%rowtype;
begin
  perform public.welfrise_require_admin_aal2();
  if nullif(btrim(p_idempotency_key),'') is null then raise exception 'Idempotency key is required'; end if;
  select result into v_previous from public.admin_mutation_keys
    where admin_id=v_admin and scope='pilot_invitation_revoke' and idempotency_key=p_idempotency_key;
  if found then return v_previous; end if;
  select * into v_invitation from public.pilot_invitations where id=p_invitation_id for update;
  if not found then raise exception 'Invitation not found'; end if;
  if v_invitation.used_at is not null then raise exception 'Used invitations cannot be revoked'; end if;
  update public.pilot_invitations set revoked_at=coalesce(revoked_at,now()) where id=p_invitation_id;
  insert into public.admin_mutation_keys(admin_id,scope,idempotency_key,result)
  values(v_admin,'pilot_invitation_revoke',p_idempotency_key,'revoked');
  insert into public.admin_audit_log(admin_id,action,entity_type,entity_id,metadata)
  values(v_admin,'pilot_invitation_revoked','pilot_invitation',p_invitation_id::text,'{}'::jsonb);
  return 'revoked';
end $$;

revoke all on function public.admin_create_pilot_invitation_v1(text,timestamptz,text) from public,anon,authenticated;
revoke all on function public.admin_revoke_pilot_invitation_v1(uuid,text) from public,anon,authenticated;
grant execute on function public.admin_create_pilot_invitation_v1(text,timestamptz,text) to authenticated;
grant execute on function public.admin_revoke_pilot_invitation_v1(uuid,text) to authenticated;
