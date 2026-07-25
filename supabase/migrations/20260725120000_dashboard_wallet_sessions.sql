-- Browser dashboard authentication is deliberately separate from permanent
-- AgentOS API tokens. Wallet signatures mint short-lived, revocable sessions.
create table if not exists public.v1_dashboard_nonces (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null,
  nonce_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (wallet_address ~ '^0x[0-9a-f]{40}$')
);

create index if not exists v1_dashboard_nonces_wallet_expiry_idx
  on public.v1_dashboard_nonces(wallet_address, expires_at);

alter table public.v1_dashboard_nonces enable row level security;
revoke all on table public.v1_dashboard_nonces from anon, authenticated;
