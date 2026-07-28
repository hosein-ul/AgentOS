-- Idempotency-Key is removed from the public AgentOS contract. Agents no longer
-- generate or send a key, and none is fabricated server-side.
--
-- Exactly-once execution of a paid operation is now keyed on the payment proof
-- itself. v1_payments.payment_payload_hash is already unique and is the sha256
-- of the PAYMENT-SIGNATURE header the agent already sends, so it identifies the
-- operation without any extra header. Storing the response against that hash is
-- what stops a retried payment proof from provisioning a second resource.

alter table public.v1_payments
  add column if not exists response_status integer,
  add column if not exists response_body jsonb,
  add column if not exists completed_at timestamptz;

alter table public.v1_payments
  drop column if exists idempotency_key;

drop table if exists public.v1_idempotency_keys;
