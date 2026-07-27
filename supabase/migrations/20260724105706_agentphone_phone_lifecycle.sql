-- AgentPhone-backed phone lifecycle, durable event inbox, and durable jobs.
-- This migration intentionally keeps legacy columns nullable so an existing
-- installation can migrate without fabricating provider identifiers.

alter table public.v1_access_tokens
  alter column expires_at drop not null;

alter table public.v1_payments
  add column if not exists service_id text,
  add column if not exists idempotency_key text,
  add column if not exists request_hash text,
  add column if not exists settlement_header text,
  add column if not exists amount text,
  add column if not exists currency text;

alter table public.v1_idempotency_keys
  add column if not exists payment_payload_hash text,
  add column if not exists payment_settlement_header text;

create index if not exists v1_payments_tenant_endpoint_idx
  on public.v1_payments(tenant_id, endpoint, created_at desc);

alter table public.v1_phone_numbers
  alter column telnyx_number_id drop not null,
  alter column connection_id drop not null,
  add column if not exists provider text not null default 'telnyx',
  add column if not exists provider_number_id text,
  add column if not exists provider_agent_id text,
  add column if not exists provider_sub_account_id text,
  add column if not exists country text,
  add column if not exists area_code text,
  add column if not exists agent_name text,
  add column if not exists agent_webhook_secret_encrypted text,
  add column if not exists provider_webhook_secret_encrypted text,
  add column if not exists provider_created_at timestamptz,
  add column if not exists entitlement_started_at timestamptz,
  add column if not exists entitlement_expires_at timestamptz,
  add column if not exists renewal_deadline timestamptz,
  add column if not exists provider_next_charge_at_estimate timestamptz,
  add column if not exists lifecycle_status text not null default 'active',
  add column if not exists inbound_seconds_balance bigint not null default 0,
  add column if not exists inbound_seconds_reserved bigint not null default 0,
  add column if not exists released_at timestamptz,
  add column if not exists release_reason text,
  add column if not exists last_provider_reconciled_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists v1_phone_numbers_provider_number_uidx
  on public.v1_phone_numbers(provider, provider_number_id)
  where provider_number_id is not null;
create unique index if not exists v1_phone_numbers_provider_agent_uidx
  on public.v1_phone_numbers(provider, provider_agent_id)
  where provider_agent_id is not null;
create index if not exists v1_phone_numbers_tenant_status_idx
  on public.v1_phone_numbers(tenant_id, lifecycle_status, entitlement_expires_at);
create index if not exists v1_phone_numbers_renewal_idx
  on public.v1_phone_numbers(lifecycle_status, renewal_deadline)
  where lifecycle_status in ('active', 'renewal_due', 'renewal_authorized');

alter table public.v1_calls
  add column if not exists provider text not null default 'telnyx',
  add column if not exists provider_call_id text,
  add column if not exists provider_sub_account_id text,
  add column if not exists from_number text,
  add column if not exists started_at timestamptz,
  add column if not exists answered_at timestamptz,
  add column if not exists ended_at timestamptz,
  add column if not exists duration_seconds integer,
  add column if not exists authorized_seconds integer not null default 0,
  add column if not exists authorized_until timestamptz,
  add column if not exists reserved_inbound_seconds integer not null default 0,
  add column if not exists source_service_id text,
  add column if not exists transcript jsonb not null default '[]'::jsonb,
  add column if not exists termination_requested_at timestamptz,
  add column if not exists provider_last_checked_at timestamptz;

create unique index if not exists v1_calls_provider_call_uidx
  on public.v1_calls(provider, provider_call_id)
  where provider_call_id is not null;
create index if not exists v1_calls_tenant_created_idx
  on public.v1_calls(tenant_id, created_at desc);
create index if not exists v1_calls_active_deadline_idx
  on public.v1_calls(status, authorized_until)
  where status in ('initiated', 'ringing', 'in-progress', 'active');

create table if not exists public.v1_phone_entitlements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.v1_users(id) on delete cascade,
  phone_number_id uuid not null references public.v1_phone_numbers(id) on delete cascade,
  payment_id uuid references public.v1_payments(id) on delete set null,
  kind text not null check (kind in ('purchase', 'renewal')),
  starts_at timestamptz not null,
  expires_at timestamptz not null,
  fixed_amount text not null,
  currency text not null default 'USDT',
  status text not null default 'active' check (status in ('active', 'superseded', 'expired')),
  created_at timestamptz not null default now(),
  unique(phone_number_id, starts_at)
);
create index if not exists v1_phone_entitlements_tenant_idx
  on public.v1_phone_entitlements(tenant_id, phone_number_id, expires_at desc);

create table if not exists public.v1_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.v1_users(id) on delete cascade,
  event_key text not null unique,
  type text not null,
  resource_type text,
  resource_id text,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'acknowledged')),
  available_at timestamptz not null default now(),
  delivered_at timestamptz,
  delivery_count integer not null default 0,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists v1_events_tenant_pending_idx
  on public.v1_events(tenant_id, status, available_at, created_at);

create table if not exists public.v1_jobs (
  id uuid primary key default gen_random_uuid(),
  job_key text not null unique,
  tenant_id uuid references public.v1_users(id) on delete cascade,
  job_type text not null,
  resource_type text,
  resource_id text,
  payload jsonb not null default '{}'::jsonb,
  run_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'dead')),
  attempts integer not null default 0,
  max_attempts integer not null default 12,
  leased_by text,
  lease_expires_at timestamptz,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists v1_jobs_due_idx
  on public.v1_jobs(status, run_at, lease_expires_at);

alter table public.v1_phone_entitlements enable row level security;
alter table public.v1_events enable row level security;
alter table public.v1_jobs enable row level security;

revoke all on table public.v1_phone_entitlements from anon, authenticated;
revoke all on table public.v1_jobs from anon, authenticated;
revoke all on table public.v1_events from anon;
revoke insert, update, delete on table public.v1_events from authenticated;
grant select on table public.v1_events to authenticated;

drop policy if exists "wallet realtime events are isolated" on public.v1_events;
create policy "wallet realtime events are isolated"
on public.v1_events
for select
to authenticated
using ((select auth.uid()) = tenant_id);

create or replace function public.v1_claim_due_jobs(
  p_worker_id text,
  p_limit integer default 25,
  p_lease_seconds integer default 120
)
returns setof public.v1_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_worker_id is null or char_length(p_worker_id) < 8 then
    raise exception 'worker id is required';
  end if;

  return query
  with candidates as (
    select id
    from public.v1_jobs
    where run_at <= now()
      and (
        status = 'pending'
        or (status = 'processing' and lease_expires_at < now())
      )
    order by run_at, created_at
    for update skip locked
    limit greatest(1, least(p_limit, 100))
  ),
  claimed as (
    update public.v1_jobs as jobs
    set status = 'processing',
        attempts = jobs.attempts + 1,
        leased_by = p_worker_id,
        lease_expires_at = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 900))),
        updated_at = now()
    from candidates
    where jobs.id = candidates.id
    returning jobs.*
  )
  select * from claimed;
end;
$$;

revoke all on function public.v1_claim_due_jobs(text, integer, integer) from public, anon, authenticated;
grant execute on function public.v1_claim_due_jobs(text, integer, integer) to service_role;

create or replace function public.v1_reserve_inbound_call(
  p_tenant_id uuid,
  p_phone_number_id uuid,
  p_provider_call_id text,
  p_provider_sub_account_id text,
  p_started_at timestamptz,
  p_from_number text,
  p_to_number text,
  p_agent_webhook_url text
)
returns public.v1_calls
language plpgsql
security definer
set search_path = public
as $$
declare
  phone public.v1_phone_numbers;
  existing_call public.v1_calls;
  created_call public.v1_calls;
  available_seconds bigint;
  started_at_value timestamptz := coalesce(p_started_at, now());
begin
  if p_provider_call_id is null or char_length(p_provider_call_id) < 3 then
    raise exception 'provider call id is required';
  end if;

  select *
  into phone
  from public.v1_phone_numbers
  where id = p_phone_number_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'owned phone number not found';
  end if;

  select *
  into existing_call
  from public.v1_calls
  where provider = 'agentphone'
    and provider_call_id = p_provider_call_id;

  if found then
    return existing_call;
  end if;

  available_seconds := greatest(
    0,
    phone.inbound_seconds_balance - phone.inbound_seconds_reserved
  );

  insert into public.v1_calls (
    tenant_id,
    phone_number_id,
    provider,
    provider_call_id,
    provider_sub_account_id,
    direction,
    status,
    from_number,
    to_number,
    agent_webhook_url,
    started_at,
    answered_at,
    authorized_seconds,
    authorized_until,
    reserved_inbound_seconds,
    source_service_id
  )
  values (
    p_tenant_id,
    p_phone_number_id,
    'agentphone',
    p_provider_call_id,
    p_provider_sub_account_id,
    'inbound',
    'in-progress',
    p_from_number,
    p_to_number,
    p_agent_webhook_url,
    started_at_value,
    started_at_value,
    available_seconds::integer,
    started_at_value + make_interval(secs => available_seconds::integer),
    available_seconds::integer,
    'phone.call.inbound.balance'
  )
  returning * into created_call;

  update public.v1_phone_numbers
  set inbound_seconds_reserved = inbound_seconds_reserved + available_seconds,
      updated_at = now()
  where id = p_phone_number_id
    and tenant_id = p_tenant_id;

  return created_call;
end;
$$;

revoke all on function public.v1_reserve_inbound_call(uuid, uuid, text, text, timestamptz, text, text, text)
  from public, anon, authenticated;
grant execute on function public.v1_reserve_inbound_call(uuid, uuid, text, text, timestamptz, text, text, text)
  to service_role;

create or replace function public.v1_finalize_inbound_call(
  p_tenant_id uuid,
  p_phone_number_id uuid,
  p_provider_call_id text,
  p_status text,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_duration_seconds integer,
  p_transcript jsonb
)
returns public.v1_calls
language plpgsql
security definer
set search_path = public
as $$
declare
  phone public.v1_phone_numbers;
  call_row public.v1_calls;
  charged_seconds integer;
begin
  select *
  into phone
  from public.v1_phone_numbers
  where id = p_phone_number_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'owned phone number not found';
  end if;

  select *
  into call_row
  from public.v1_calls
  where provider = 'agentphone'
    and provider_call_id = p_provider_call_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'owned inbound call not found';
  end if;

  if call_row.direction <> 'inbound' then
    raise exception 'call is not inbound';
  end if;

  if call_row.status in ('completed', 'failed', 'ended', 'canceled') then
    return call_row;
  end if;

  charged_seconds := least(
    greatest(coalesce(p_duration_seconds, 0), 0),
    greatest(coalesce(call_row.reserved_inbound_seconds, 0), 0)
  );

  update public.v1_calls
  set status = coalesce(nullif(p_status, ''), 'completed'),
      started_at = coalesce(p_started_at, call_row.started_at),
      ended_at = coalesce(p_ended_at, now()),
      duration_seconds = greatest(coalesce(p_duration_seconds, 0), 0),
      transcript = coalesce(p_transcript, '[]'::jsonb),
      updated_at = now()
  where id = call_row.id
  returning * into call_row;

  update public.v1_phone_numbers
  set inbound_seconds_balance = greatest(0, inbound_seconds_balance - charged_seconds),
      inbound_seconds_reserved = greatest(
        0,
        inbound_seconds_reserved - greatest(coalesce(call_row.reserved_inbound_seconds, 0), 0)
      ),
      updated_at = now()
  where id = p_phone_number_id
    and tenant_id = p_tenant_id;

  return call_row;
end;
$$;

revoke all on function public.v1_finalize_inbound_call(uuid, uuid, text, text, timestamptz, timestamptz, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.v1_finalize_inbound_call(uuid, uuid, text, text, timestamptz, timestamptz, integer, jsonb)
  to service_role;

create or replace function public.v1_renew_phone_entitlement(
  p_tenant_id uuid,
  p_phone_number_id uuid,
  p_fixed_amount text,
  p_currency text
)
returns public.v1_phone_numbers
language plpgsql
security definer
set search_path = public
as $$
declare
  phone public.v1_phone_numbers;
  next_expiry timestamptz;
begin
  select *
  into phone
  from public.v1_phone_numbers
  where id = p_phone_number_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'owned phone number not found';
  end if;
  if phone.lifecycle_status not in ('active', 'renewal_due', 'renewal_authorized')
    or phone.entitlement_expires_at is null
    or phone.entitlement_expires_at <= now()
  then
    raise exception 'phone entitlement is not renewable';
  end if;
  if phone.entitlement_expires_at > now() + interval '31 days' then
    raise exception 'phone already has a future renewal cycle';
  end if;

  next_expiry := phone.entitlement_expires_at + interval '30 days';

  insert into public.v1_phone_entitlements (
    tenant_id,
    phone_number_id,
    kind,
    starts_at,
    expires_at,
    fixed_amount,
    currency
  )
  values (
    p_tenant_id,
    p_phone_number_id,
    'renewal',
    phone.entitlement_expires_at,
    next_expiry,
    p_fixed_amount,
    p_currency
  );

  update public.v1_phone_numbers
  set entitlement_started_at = phone.entitlement_expires_at,
      entitlement_expires_at = next_expiry,
      renewal_deadline = next_expiry,
      provider_next_charge_at_estimate = phone.entitlement_expires_at,
      lifecycle_status = 'renewal_authorized',
      active = true,
      updated_at = now()
  where id = p_phone_number_id
    and tenant_id = p_tenant_id
  returning * into phone;

  return phone;
end;
$$;

revoke all on function public.v1_renew_phone_entitlement(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.v1_renew_phone_entitlement(uuid, uuid, text, text)
  to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'v1_events'
    )
  then
    execute 'alter publication supabase_realtime add table public.v1_events';
  end if;
end
$$;
