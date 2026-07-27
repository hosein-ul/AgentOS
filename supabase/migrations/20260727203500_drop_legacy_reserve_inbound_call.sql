-- CONTRACT phase: remove the retired eight-argument inbound-call reservation.
--
-- Pairs with the EXPAND phase in 20260727203201_live_voice_websocket.sql, which
-- added the seven-argument overload without removing this one.
--
-- DO NOT APPLY THIS UNTIL the deployed application no longer sends
-- p_agent_webhook_url. Until then both overloads must coexist: the previously
-- deployed code path calls the eight-argument version, and dropping it early
-- breaks live inbound calls.
--
-- Safe to apply once `GET /api/v1` reports the live-voice build and inbound calls
-- are confirmed working against the seven-argument overload.
--
-- Verify before applying:
--   select p.oid::regprocedure
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'v1_reserve_inbound_call';
-- Expect both the 7-arg and 8-arg signatures; this migration leaves only 7-arg.

drop function if exists public.v1_reserve_inbound_call(
  uuid, uuid, text, text, timestamptz, text, text, text
);
