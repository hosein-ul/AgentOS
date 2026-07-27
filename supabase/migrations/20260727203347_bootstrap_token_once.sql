-- The bootstrap access token is issued exactly once per wallet tenant.
--
-- Previously an idempotent replay of the first paid provisioning request minted a
-- brand new permanent token on every retry, so a caller replaying the same
-- Idempotency-Key accumulated unlimited valid credentials.
--
-- The claim is recorded on the tenant, not on the idempotency row, so the
-- guarantee holds across endpoints, retries and concurrent requests: issuing is a
-- conditional UPDATE ... WHERE bootstrap_token_issued_at IS NULL, which exactly
-- one transaction can win.
--
-- Deliberate rotation stays available through the wallet-authenticated dashboard
-- (token.create), which is unaffected by this column.

alter table public.v1_users
  add column if not exists bootstrap_token_issued_at timestamptz;

comment on column public.v1_users.bootstrap_token_issued_at is
  'Set when the one-time bootstrap access token was issued. Claimed atomically; never cleared. Rotation goes through the wallet dashboard.';

-- Backfill existing tenants so a wallet that already holds a token cannot obtain
-- another one through a bootstrap replay after this migration is applied.
update public.v1_users u
set bootstrap_token_issued_at = coalesce(
  (select min(t.created_at) from public.v1_access_tokens t where t.tenant_id = u.id),
  u.created_at
)
where u.bootstrap_token_issued_at is null
  and exists (select 1 from public.v1_access_tokens t where t.tenant_id = u.id);
