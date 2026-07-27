-- Realtime delivery now runs through the tenant-authenticating AgentOS gateway.
-- Browser roles no longer need direct SELECT access to the durable inbox.

drop policy if exists "wallet realtime events are isolated" on public.v1_events;
revoke all on table public.v1_events from anon, authenticated;
