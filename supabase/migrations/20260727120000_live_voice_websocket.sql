-- Customer Agents no longer expose a public webhook.
--
-- Live voice turns are now brokered over the AgentOS realtime gateway:
--   AgentPhone -> AgentOS provider webhook -> gateway -> customer Agent socket
--   -> customer Agent reply -> AgentOS -> AgentPhone TTS.
--
-- Forward-only. The agent_webhook_url and agent_webhook_secret_encrypted columns
-- are deliberately retained (nullable) rather than dropped:
--   * rows provisioned before this change still carry historical values;
--   * dropping them would make the already-applied 20260724105651 and
--     20260724105706 migrations non-reproducible against this schema.
-- Nothing in the application reads or writes them any more, and they are never
-- included in a customer-facing response. See docs.md "Retained legacy columns".

alter table public.v1_phone_numbers
  alter column agent_webhook_url drop not null;

alter table public.v1_calls
  alter column agent_webhook_url drop not null;

comment on column public.v1_phone_numbers.agent_webhook_url is
  'Retired. Live voice uses the AgentOS WebSocket gateway. Retained nullable for migration safety; never read, written or exposed.';
comment on column public.v1_phone_numbers.agent_webhook_secret_encrypted is
  'Retired customer callback secret. Retained nullable for migration safety; never read, written or exposed.';
comment on column public.v1_calls.agent_webhook_url is
  'Retired. Live voice uses the AgentOS WebSocket gateway. Retained nullable for migration safety; never read, written or exposed.';

-- Inbound call reservation no longer takes a customer callback URL. Replace the
-- eight-argument version with a seven-argument one; argument count cannot change
-- via create or replace.
drop function if exists public.v1_reserve_inbound_call(uuid, uuid, text, text, timestamptz, text, text, text);

create or replace function public.v1_reserve_inbound_call(
  p_tenant_id uuid,
  p_phone_number_id uuid,
  p_provider_call_id text,
  p_provider_sub_account_id text,
  p_started_at timestamptz,
  p_from_number text,
  p_to_number text
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

revoke all on function public.v1_reserve_inbound_call(uuid, uuid, text, text, timestamptz, text, text)
  from public, anon, authenticated;
grant execute on function public.v1_reserve_inbound_call(uuid, uuid, text, text, timestamptz, text, text)
  to service_role;
