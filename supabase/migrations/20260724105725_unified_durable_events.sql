-- Provider-independent durable event inbox and explicit legacy-table hardening.
-- This migration is additive except for replacing the narrow v1_events status
-- check. It does not delete application data.

alter table public.v1_events
  add column if not exists service text,
  add column if not exists agent_id text,
  add column if not exists expires_at timestamptz,
  add column if not exists delivery_attempts integer not null default 0,
  add column if not exists delivery_lease_until timestamptz,
  add column if not exists delivered_by text,
  add column if not exists last_delivery_error text,
  add column if not exists failed_at timestamptz;

alter table public.v1_messages
  drop constraint if exists v1_messages_provider_message_id_key;
create unique index if not exists v1_messages_mailbox_provider_message_uidx
  on public.v1_messages(mailbox_id, provider_message_id)
  where provider_message_id is not null;

update public.v1_events
set service = case
  when type like 'email.%' then 'email'
  when type like 'phone.%' then 'phone'
  when type like 'domain.%' then 'domain'
  when type like 'payment.%' then 'billing'
  else 'system'
end
where service is null;

alter table public.v1_events
  alter column service set default 'system',
  alter column service set not null;

alter table public.v1_events drop constraint if exists v1_events_status_check;
alter table public.v1_events
  add constraint v1_events_status_check
  check (status in ('pending', 'delivered', 'acknowledged', 'expired', 'failed'));

create index if not exists v1_events_tenant_status_created_idx
  on public.v1_events(tenant_id, status, created_at, id);
create index if not exists v1_events_agent_status_idx
  on public.v1_events(tenant_id, agent_id, status, created_at)
  where agent_id is not null;
create index if not exists v1_events_type_idx
  on public.v1_events(tenant_id, type, created_at);
create index if not exists v1_events_resource_idx
  on public.v1_events(tenant_id, resource_type, resource_id, created_at)
  where resource_id is not null;
create index if not exists v1_events_expiry_idx
  on public.v1_events(expires_at, status)
  where expires_at is not null and status in ('pending', 'delivered');
create index if not exists v1_events_delivery_scan_idx
  on public.v1_events(tenant_id, available_at, delivery_lease_until, created_at)
  where status in ('pending', 'delivered');

create or replace function public.v1_claim_events_for_delivery(
  p_tenant_id uuid,
  p_delivered_by text,
  p_limit integer default 50,
  p_lease_seconds integer default 60
)
returns setof public.v1_events
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_tenant_id is null or p_delivered_by is null or char_length(p_delivered_by) < 3 then
    raise exception 'tenant and delivery worker are required';
  end if;

  update public.v1_events
  set status = 'expired',
      delivery_lease_until = null
  where tenant_id = p_tenant_id
    and status in ('pending', 'delivered')
    and expires_at is not null
    and expires_at <= now();

  return query
  with candidates as (
    select id
    from public.v1_events
    where tenant_id = p_tenant_id
      and available_at <= now()
      and (expires_at is null or expires_at > now())
      and (
        status = 'pending'
        or (
          status = 'delivered'
          and (delivery_lease_until is null or delivery_lease_until <= now())
        )
      )
    order by created_at, id
    for update skip locked
    limit greatest(1, least(p_limit, 100))
  )
  update public.v1_events as events
  set status = 'delivered',
      delivered_at = coalesce(events.delivered_at, now()),
      delivery_count = events.delivery_count + 1,
      delivery_attempts = events.delivery_attempts + 1,
      delivery_lease_until = now() + make_interval(secs => greatest(15, least(p_lease_seconds, 300))),
      delivered_by = p_delivered_by,
      last_delivery_error = null
  from candidates
  where events.id = candidates.id
  returning events.*;
end;
$$;

revoke all on function public.v1_claim_events_for_delivery(uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.v1_claim_events_for_delivery(uuid, text, integer, integer)
  to service_role;

-- The connected production database still contains these legacy tables.
-- They are used only through the server service role, so direct browser roles
-- must not be able to enumerate tokens, mail, or tenant records.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'User', 'Agent', 'Email', 'Attachment', 'ApiKey', 'EmailTemplate', 'AccessToken'
  ]
  loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('alter table public.%I enable row level security', table_name);
      execute format('revoke all on table public.%I from anon, authenticated', table_name);
    end if;
  end loop;
end
$$;

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
