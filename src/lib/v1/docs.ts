import { SERVICE_CATALOG } from "./service-catalog"

const catalogRows = SERVICE_CATALOG.map((service) => [
  `| ${service.id}`,
  `${service.method} ${service.endpoint}`,
  service.paid ? `${service.amount} ${service.currency}` : "free",
  service.authenticated ? "Bearer" : service.startHere ? "x402 bootstrap" : "none",
  service.startHere ? "yes" : "no",
  service.available ? service.description : `UNAVAILABLE: ${service.description}`,
  "|",
].join(" | ")).join("\n")

const machineCatalog = SERVICE_CATALOG.map((service) => [
  `- ${service.id}: ${service.method} ${service.endpoint}`,
  `price=${service.paid ? `${service.amount} ${service.currency}` : "free"}`,
  `startHere=${service.startHere}`,
  `auth=${service.authenticated ? "Bearer at_v1" : service.startHere ? "x402 bootstrap" : "none"}`,
  `available=${service.available}`,
  `guide=${service.guide}`,
  `purpose=${service.description}`,
].join("; ")).join("\n")

export const agentDocs = String.raw`# AgentOS ASP v1

AgentOS is a wallet-isolated REST Agent Service Provider for OKX.AI. It provides real Resend email and AgentPhone telephony. Domain registration remains unavailable until fixed per-TLD prices and stable registrar egress are configured. AgentOS is not an MCP server, never returns simulated provider success, and does not expose phone recordings.

## Canonical discovery

- GET /api/v1 — API identity, authentication rules, and compact catalog.
- GET /api/v1/services — canonical service records.
- GET /api/v1/services/{serviceId} — one service record.
- GET /openapi.json — OpenAPI 3.1.
- GET /llms.txt — autonomous-agent start and recovery guide.
- GET /docs — this document.

## Start here

An unused wallet can bootstrap only through an available provisioning service:

- Email: email.mailbox.create at POST /api/v1/email/mailboxes.
- Phone US: phone.number.us.30d at POST /api/v1/phone/purchase-us-number-30-days.
- Phone Canada: phone.number.ca.30d at POST /api/v1/phone/purchase-canada-number-30-days.
- Domain: domain.register is intentionally unavailable and never requests payment.

A secondary paid endpoint without an AgentOS token returns HTTP 428 ONBOARDING_REQUIRED before a payment challenge or settlement. Its JSON includes the correct service ID, method, endpoint, fixed price, required input, /llms.txt, /api/v1/services, /openapi.json, and the service guide.

## Authentication and OKX x402

There is no paid token endpoint.

1. Send the start-here business request without Authorization.
2. Receive HTTP 402 and PAYMENT-REQUIRED.
3. Use the OKX Agent Payments Protocol client to quote, obtain user approval, pay, and replay the identical method, URL, and body.
4. On replay send PAYMENT-SIGNATURE and Idempotency-Key.
5. AgentOS verifies the payer and request binding, settles once, performs the real provider operation, and returns authentication.accessToken.
6. Store the at_v1 token. It has no automatic expiry and belongs to the payer wallet tenant.
7. Reuse the same token across Email, Phone, Events, and future Domain services. Every later paid service still has its own fixed x402 charge.

The x402 payer of a secondary request must equal the wallet bound to the bearer token. A missing token returns ONBOARDING_REQUIRED, an invalid/revoked token returns AUTH_REQUIRED, and a valid token cannot access another tenant's resource. Resource ownership preflight occurs before payment preparation where an input ID identifies a mailbox, phone number, or call.

Idempotency-Key is required on paid POSTs. It is not authentication and has no price. Reuse the same key only for a byte-equivalent retry. A key is bound to tenant, endpoint, request hash, and payment proof.

## Service catalog

The following table is generated from the same catalog used by route payment middleware and discovery:

| Service ID | Method and path | Fixed price | Auth | Start here | Purpose |
| --- | --- | ---: | --- | --- | --- |
${catalogRows}

Only available paid business operations with registerOnOkx=true are marketplace ASP services. Discovery, reads, event inbox operations, webhooks, health checks, scheduler routes, and WebSocket upgrades are not paid A2MCP listings.

## Common envelopes

Success:

~~~json
{
  "data": {},
  "requestId": "uuid",
  "guide": "/docs#..."
}
~~~

Error:

~~~json
{
  "error": {
    "code": "ONBOARDING_REQUIRED",
    "message": "...",
    "requestId": "uuid"
  },
  "guides": {
    "llms": "/llms.txt",
    "serviceCatalog": "/api/v1/services",
    "openapi": "/openapi.json"
  }
}
~~~

Paid success also returns PAYMENT-RESPONSE.

## Email flow

1. Create a mailbox with POST /api/v1/email/mailboxes and save authentication.accessToken.
2. Send mail with POST /api/v1/email/messages/send.
3. List or retrieve a complete message with GET /api/v1/email/messages/query.
4. Connect to the event WebSocket and handle email.received.
5. Use payload.emailId to retrieve the full body. Event payloads intentionally omit body and attachment content.
6. Acknowledge only after local durable handling.

Create:

~~~json
{
  "localPart": "research-agent",
  "displayName": "Research Agent",
  "outboundSignature": "optional"
}
~~~

Send:

~~~json
{
  "mailboxId": "uuid",
  "to": ["recipient@example.com"],
  "subject": "Status",
  "text": "The task is complete."
}
~~~

The Resend webhook is verified before fetch. AgentOS matches every active recipient mailbox, persists one message per mailbox, and creates an idempotent email.received durable event:

~~~json
{
  "type": "email.received",
  "eventId": "uuid",
  "mailboxId": "uuid",
  "emailId": "uuid",
  "from": "sender@example.com",
  "subject": "Subject",
  "receivedAt": "ISO-8601"
}
~~~

Only email.received is normalized today because it is the Resend lifecycle currently persisted by v1. Unsupported provider events are recorded as webhook audit rows but are not invented as AgentOS events.

## Phone flow

1. Buy a US or Canada number for 5.00 USDT / 30 days.
2. Save the AgentOS access token, phoneNumberId, E.164 number, and one-time callbackVerificationSecret.
3. AgentPhone calls AgentOS. AgentOS verifies provider HMAC and maps provider IDs to the owning tenant.
4. AgentOS forwards each live agent.message to agentWebhookUrl with X-AgentOS-Timestamp and X-AgentOS-Signature.
5. The external AI agent dynamically returns JSON such as {"text":"..."} or {"hangup":true}, or supported NDJSON.
6. Start outbound packages with call-1-minute or call-5-minutes. Extend an active call with extend-call-1-minute.
7. Prepay inbound time with add-inbound-minutes-10.
8. Query calls and transcripts through free authenticated reads.
9. Renew before entitlement expiry or release explicitly.

Purchase input:

~~~json
{
  "agentName": "support-agent",
  "agentWebhookUrl": "https://agent.example.com/voice",
  "areaCode": "415",
  "beginMessage": "Hello, how can I help?",
  "language": "en-US"
}
~~~

Outbound call:

~~~json
{
  "phoneNumberId": "uuid",
  "toNumber": "+14155550123",
  "initialGreeting": "Hello"
}
~~~

Recording is out of scope. AgentOS does not enable or expose recording endpoints, controls, URLs, or prices. Provider media/recording fields are stripped; transcripts remain available.

AgentOS currently uses one operator AgentPhone billing account. The provider API key is server-only, and provider number/agent/call IDs are uniquely mapped to one wallet tenant before every operation. AgentPhone sub-accounts are optional extra isolation but are not used one-per-agent because the provider currently limits a master account to 25.

## Number renewal

The internal entitlement is exactly 30 days. Fixed purchase and renewal prices are each 5.00 USDT. Durable jobs generate phone.number.expiring events 5, 3, and 1 days before expiry. Each event includes phoneNumberId, phone number, expiry, renewal deadline, fixed price, renewal endpoint, request body, and release warning.

Renew:

~~~json
{
  "phoneNumberId": "uuid"
}
~~~

AgentPhone renews provider numbers from the shared provider balance and does not expose an explicit renewal endpoint or authoritative next-renewal timestamp. AgentOS therefore extends its internal entitlement, later reconciles provider active status, suspends expired internal usage, and attempts irreversible provider deletion before unwanted future charges. Deletion and provider billing cannot be made transactional at the exact renewal boundary; this is a documented provider limitation and requires worker monitoring.

## Event delivery

Every supported provider or internal transition follows:

provider webhook or durable job → normalize → insert v1_events → immediate WebSocket delivery when online → durable REST replay when offline → explicit acknowledgement → retained audit row.

REST:

- POST /api/v1/events/list — filters: status, types, agentId, service, resourceId, from, to, limit, cursor.
- POST /api/v1/events/get — {"eventId":"uuid"}.
- POST /api/v1/events/ack — idempotent {"eventId":"uuid"}.
- POST /api/v1/events/ack-all — explicit before cutoff plus optional types/service.
- GET /api/v1/events/realtime-token — 15-minute gateway credential and reconnect replay.
- GET /api/v1/events and POST /api/v1/events/{id}/acknowledge — backward-compatible aliases.

States are pending, delivered, acknowledged, expired, and failed. deliveredAt never implies acknowledgement. Expired events are neither delivered nor replayed. Events are ordered by createdAt then eventId. Delivery uses a database lease to avoid concurrent duplicate delivery; if a socket disappears before acknowledgement, the durable event becomes replayable after the lease.

Supported normalized events include email.received; phone.call.ended; phone.number.expiring; phone.number.renewed; phone.number.released; provider reconciliation variants; payment.completed; and payment.failed. Events marked source=agentos.internal are AgentOS state transitions, not provider-native claims.

## WebSocket protocol

1. Call GET /api/v1/events/realtime-token with the main bearer token.
2. Connect to realtime.websocketUrl. Production requires wss://.
3. Send:

~~~json
{"type":"session.authenticate","token":"short-lived realtime token"}
~~~

4. Receive session.ready, followed by deterministic event.delivery replay, then session.replay.complete.
5. After durable processing send:

~~~json
{"type":"event.ack","eventId":"uuid"}
~~~

6. Receive event.acknowledged. Use POST /api/v1/events/ack if the socket acknowledgement is ambiguous.

The no-expiry at_v1 API credential and short-lived realtime credential are intentionally different. Never put an API token in a WebSocket URL or log it.

## Domain flow

The code contains a real Namecheap adapter, but public domain registration returns 503 without a payment challenge. Namecheap requires an allowlisted public IPv4; default dynamic Vercel egress is unsuitable. Before enabling Domain, AgentOS still needs fixed per-TLD register/renew prices, search/list/DNS/renew routes in v1, provider tests, static egress, and domain event normalization. Do not register domain.register on OKX until available=true.

## Scheduling and workers

Vercel Cron is a production-deployment scheduler that invokes a Vercel Function. It is not a queue or long-running worker. The repository config uses one daily 03:00 UTC safety sweep, compatible with Vercel Hobby's once-daily limit. The route performs one short, idempotent batch.

The continuously running services/durable-worker process invokes short batches every five seconds for call deadlines, provider retries, releases, and reconciliation. v1_jobs is the durable source of truth; jobs use leases, SKIP LOCKED, bounded exponential backoff, and dead state. The realtime gateway is also a separate continuously running WebSocket service because Vercel Functions do not host persistent WebSocket servers.

Vercel Pro is required only if Vercel itself must invoke cron more than daily. It does not remove the need for the separate worker for sub-minute call enforcement.

## Errors and recovery

- ONBOARDING_REQUIRED: call the returned startHere endpoint; do not pay the failed secondary request.
- AUTH_REQUIRED: provide a valid at_v1 token or start with provisioning.
- INVALID_TOKEN: obtain/use the correct non-revoked token.
- FORBIDDEN / RESOURCE_NOT_OWNED: never substitute a tenant ID; use a resource owned by this token.
- PAYMENT_REQUIRED: quote, confirm, pay, and replay the identical request.
- PAYMENT_PENDING: do not submit a second payment; poll/retry unchanged.
- IDEMPOTENCY_CONFLICT: use the original body or a new key for a genuinely new operation.
- RESOURCE_NOT_FOUND: refresh owned resources; do not guess IDs.
- PROVIDER_TEMPORARY_FAILURE: retry the same operation with the same key/proof after backoff.
- ALLOWANCE_EXHAUSTED: buy inbound minutes before accepting more inbound speech.
- NUMBER_EXPIRING: renew through phone.number.renew.30d.
- NUMBER_RELEASED: the number is irreversible; buy a new number.

## Deployment and security

Apply migrations in timestamp order and run Supabase security/performance advisors. v1 server access uses only SUPABASE_SERVICE_ROLE_KEY; browser roles receive no table grants except the legacy Realtime policy retained for migration compatibility. The connected legacy tables must have RLS enabled and anon/authenticated grants revoked.

Required groups: APP_URL; OKX credentials and payment wallet; Supabase URL/service role; Resend API/webhook/domain; AgentPhone API/base URL; PHONE_SECRET_ENCRYPTION_KEY; CRON_SECRET; REALTIME_GATEWAY_URL and REALTIME_GATEWAY_JWT_SECRET; private dashboard Basic credentials. Domain variables remain unset until production activation.

Dashboard paths are owner-only HTTP Basic Auth and are not an agent auth surface. Provider webhooks and internal worker routes are infrastructure, not marketplace services.
`

export const llmsText = String.raw`# AgentOS

AgentOS is a wallet-isolated REST ASP for autonomous agents on OKX.AI. It provides real Resend email and AgentPhone telephony with fixed per-call USDT prices through the OKX Agent Payments Protocol. It is not MCP and never simulates provider success.

## Canonical resources

- [Service catalog](/api/v1/services): canonical service IDs, fixed prices, inputs, errors, and next actions.
- [OpenAPI](/openapi.json): complete OpenAPI 3.1 contract.
- [Operational guide](/docs): authentication, service flows, WebSocket protocol, deployment, and recovery.
- [API root](/api/v1): compact discovery.

## Start Here

- Email starts with email.mailbox.create: POST /api/v1/email/mailboxes.
- Phone starts with phone.number.us.30d or phone.number.ca.30d.
- Domain registration is unavailable; do not send payment.
- A first provisioning call uses x402 and returns authentication.accessToken after real fulfillment.
- Every secondary endpoint requires that credential. Missing credentials return HTTP 428 ONBOARDING_REQUIRED before payment settlement.

## Authentication

Wallet/payer identity creates the tenant boundary. First send the provisioning body, receive PAYMENT-REQUIRED, use an OKX x402 quote/pay flow with explicit payer approval, and replay the identical request with PAYMENT-SIGNATURE and Idempotency-Key. Save the returned at_v1 access token. It has no automatic expiry and is shared across all services for the same wallet. Every paid endpoint has an independent fixed charge.

The realtime token is different: obtain it from GET /api/v1/events/realtime-token. It expires after 15 minutes and authenticates only the WebSocket event session.

## Service Catalog

${machineCatalog}

## Email Flow

Create mailbox → save access token → send/list/read → connect WebSocket → handle email.received safe summary → fetch full message with emailId → POST /api/v1/events/ack.

Create body: {"localPart":"research-agent","displayName":"Research Agent"}
Send body: {"mailboxId":"uuid","to":["recipient@example.com"],"subject":"Subject","text":"Body"}

## Phone Flow

Buy number → save token/phoneNumberId/callback secret → accept signed live voice callbacks → return dynamic text/hangup → buy outbound call packages or inbound allowance → monitor phone.number.expiring → renew for 5.00 USDT / 30 days → release safely when no longer needed.

Buy body: {"agentName":"support-agent","agentWebhookUrl":"https://agent.example.com/voice","areaCode":"415"}
Call body: {"phoneNumberId":"uuid","toNumber":"+14155550123"}
Renew body: {"phoneNumberId":"uuid"}
Release body: {"phoneNumberId":"uuid","confirmRelease":true}

Recordings are never enabled or exposed. Use transcripts.

## Domain Flow

Unavailable today. The real adapter requires fixed per-TLD services and static allowlisted Namecheap egress. available=false means do not pay and do not register the service on OKX.

## Event Delivery

WebSocket gives immediate delivery; Supabase v1_events is the durable inbox. Authenticate the socket with session.authenticate; wait for session.ready; process event.delivery in order; send event.ack after durable local handling. On reconnect the gateway replays unacknowledged non-expired events. REST recovery: POST /api/v1/events/list, /get, /ack, /ack-all.

Email events contain IDs/from/subject/time, not body or attachments. Supported events are documented in /docs; AgentOS internal events identify their source.

## Errors and Recovery

- ONBOARDING_REQUIRED: call error.startHere; do not pay the failed request.
- AUTH_REQUIRED or INVALID_TOKEN: use the correct at_v1 token.
- PAYMENT_REQUIRED: quote, confirm, pay, replay unchanged.
- PAYMENT_PENDING: do not pay twice.
- IDEMPOTENCY_CONFLICT: retry the original body/key or start a new logical operation.
- RESOURCE_NOT_FOUND / RESOURCE_NOT_OWNED: refresh owned IDs; never guess tenant IDs.
- PROVIDER_TEMPORARY_FAILURE: retry unchanged with backoff.
- ALLOWANCE_EXHAUSTED: buy inbound allowance.
- NUMBER_EXPIRING: renew now.
- NUMBER_RELEASED: buy a new number.

## Idempotency

Send Idempotency-Key on every paid mutation. Reuse it only with the identical method, endpoint, body, and payment proof after an ambiguous response.

## Fixed Pricing

Public prices come only from the AgentOS service catalog and do not change automatically with provider pricing.

## Complete example

1. GET /api/v1/services/email.mailbox.create.
2. POST the mailbox body; receive 402.
3. Quote/pay with explicit approval and replay with PAYMENT-SIGNATURE plus Idempotency-Key.
4. Save authentication.accessToken.
5. GET /api/v1/events/realtime-token with Authorization: Bearer at_v1_...
6. Connect to websocketUrl and send {"type":"session.authenticate","token":"..."}.
7. On email.received, GET /api/v1/email/messages/query?messageId=... with the bearer token.
8. POST /api/v1/events/ack with {"eventId":"..."}.
`
