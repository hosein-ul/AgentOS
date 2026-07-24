-- AgentOS v1 is intentionally separate from the legacy schema.  Apply this
-- migration with the Supabase service role before exposing /api/v1.
create extension if not exists pgcrypto;

create table if not exists public.v1_users (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null unique,
  created_at timestamptz not null default now(),
  check (wallet_address ~ '^0x[0-9a-f]{40}$')
);
create table if not exists public.v1_access_tokens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.v1_users(id) on delete cascade,
  token_hash text not null unique,
  token_prefix text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists v1_access_tokens_tenant_idx on public.v1_access_tokens(tenant_id);
create table if not exists public.v1_idempotency_keys (
  tenant_id uuid not null references public.v1_users(id) on delete cascade,
  endpoint text not null,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 255),
  request_hash text not null,
  status text not null check (status in ('in_progress','completed')),
  response_status integer,
  response_body jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (tenant_id, endpoint, idempotency_key)
);
create table if not exists public.v1_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.v1_users(id) on delete cascade,
  endpoint text not null,
  payer_wallet text not null,
  payment_payload_hash text not null unique,
  settlement jsonb not null,
  created_at timestamptz not null default now()
);
create table if not exists public.v1_mailboxes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.v1_users(id) on delete cascade,
  email_address text not null unique,
  local_part text not null,
  display_name text,
  outbound_signature text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists v1_mailboxes_tenant_idx on public.v1_mailboxes(tenant_id);
create table if not exists public.v1_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.v1_users(id) on delete cascade,
  mailbox_id uuid not null references public.v1_mailboxes(id) on delete cascade,
  provider_message_id text unique,
  provider_thread_id text,
  direction text not null check (direction in ('inbound','outbound')),
  from_address text not null,
  to_addresses jsonb not null,
  cc_addresses jsonb,
  bcc_addresses jsonb,
  reply_to text,
  subject text not null,
  text_body text,
  html_body text,
  status text not null,
  rfc_message_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists v1_messages_tenant_created_idx on public.v1_messages(tenant_id, created_at desc);
create index if not exists v1_messages_mailbox_idx on public.v1_messages(mailbox_id, created_at desc);
create table if not exists public.v1_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique(provider, provider_event_id)
);
create table if not exists public.v1_phone_numbers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.v1_users(id) on delete cascade,
  phone_number text not null unique,
  telnyx_number_id text not null unique,
  connection_id text not null,
  agent_webhook_url text not null,
  media_stream_url text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.v1_calls (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.v1_users(id) on delete cascade,
  phone_number_id uuid references public.v1_phone_numbers(id) on delete set null,
  telnyx_call_control_id text unique,
  telnyx_call_leg_id text,
  direction text not null check (direction in ('inbound','outbound')),
  status text not null,
  to_number text,
  agent_webhook_url text not null,
  media_stream_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.v1_domains (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.v1_users(id) on delete cascade,
  domain_name text not null unique,
  registrar_domain_id text,
  expires_at timestamptz,
  status text not null,
  contact_encrypted text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.v1_dns_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.v1_users(id) on delete cascade,
  domain_id uuid not null references public.v1_domains(id) on delete cascade,
  host text not null,
  record_type text not null,
  value text not null,
  ttl integer,
  mx_preference integer,
  created_at timestamptz not null default now()
);

-- No browser client is ever allowed to read these tables.  The server service
-- role bypasses RLS, and every server query additionally scopes by tenant_id.
alter table public.v1_users enable row level security;
alter table public.v1_access_tokens enable row level security;
alter table public.v1_idempotency_keys enable row level security;
alter table public.v1_payments enable row level security;
alter table public.v1_mailboxes enable row level security;
alter table public.v1_messages enable row level security;
alter table public.v1_webhook_events enable row level security;
alter table public.v1_phone_numbers enable row level security;
alter table public.v1_calls enable row level security;
alter table public.v1_domains enable row level security;
alter table public.v1_dns_records enable row level security;
revoke all on table public.v1_users from anon, authenticated;
revoke all on table public.v1_access_tokens from anon, authenticated;
revoke all on table public.v1_idempotency_keys from anon, authenticated;
revoke all on table public.v1_payments from anon, authenticated;
revoke all on table public.v1_mailboxes from anon, authenticated;
revoke all on table public.v1_messages from anon, authenticated;
revoke all on table public.v1_webhook_events from anon, authenticated;
revoke all on table public.v1_phone_numbers from anon, authenticated;
revoke all on table public.v1_calls from anon, authenticated;
revoke all on table public.v1_domains from anon, authenticated;
revoke all on table public.v1_dns_records from anon, authenticated;
