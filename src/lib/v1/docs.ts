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

AgentOS is a wallet-isolated REST Agent Service Provider for OKX.AI. It provides real Resend email and AgentPhone telephony. Domain registration is unavailable; Cloudflare-backed support is planned but not implemented. AgentOS is not an MCP server, never returns simulated provider success, and does not expose phone recordings.

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

A secondary paid endpoint identifies its tenant from three signals, in order: (1) a bearer AgentOS access token, (2) the x402-verified payer wallet, once that wallet already has an AgentOS tenant from a prior paid provisioning, and (3) a brand-new wallet paying a startHere service. Only a request that matches none of these — no bearer, unknown payer wallet, non-startHere endpoint — returns HTTP 428 ONBOARDING_REQUIRED, before any payment challenge or settlement. Its JSON includes the correct service ID, method, endpoint, fixed price, required input, /llms.txt, /api/v1/services, /openapi.json, and the service guide.

## Authentication and OKX x402

There is no paid token endpoint.

1. Send the start-here business request without Authorization.
2. Receive HTTP 402 and PAYMENT-REQUIRED.
3. Use the OKX Agent Payments Protocol client to quote, obtain user approval, pay, and replay the identical method, URL, and body.
4. On replay send PAYMENT-SIGNATURE.
5. AgentOS verifies the payer and request binding, settles once, performs the real provider operation, and returns authentication.accessToken.
6. Store the at_v1 token. It has no automatic expiry and belongs to the payer wallet tenant.
7. Reuse the same token across Email, Phone, Events, and future Domain services. Every later paid service still has its own fixed x402 charge.

When a bearer token is present, the x402 payer of a secondary request must equal the wallet bound to that token. When no bearer is present, the request is authenticated by the x402 payer wallet itself and the tenant is resolved from it; an unknown wallet on a non-startHere endpoint returns ONBOARDING_REQUIRED, an invalid/revoked bearer returns AUTH_REQUIRED, and a valid bearer cannot access another tenant's resource. Resource ownership preflight occurs before payment settlement wherever an input ID identifies a mailbox, phone number, or call.

No idempotency header is required or accepted. The payment proof is the identity of a paid operation: it is bound to the endpoint and the request body, it settles at most once, and replaying it returns the stored response instead of repeating the operation.

## Access token recovery

The access token is issued exactly once per wallet and is shown only once. AgentOS
stores only its SHA-256 hash and can never show it again.

Replaying the first provisioning request does not mint a second token. Replaying a
completed payment proof returns the stored business response together with:

~~~json
{
  "authentication": {
    "status": "already_issued",
    "accessToken": null,
    "walletAddress": "0x...",
    "guide": "/docs#access-token-recovery"
  }
}
~~~

The provider operation is not repeated and no payment is settled again. Retrying
harder will never produce a token.

If the token is lost, sign in at /dashboard with the owning wallet, issue a
replacement, and revoke the old one. That wallet-signature flow is the only
supported rotation and recovery path.

## Service catalog

The following table is generated from the same catalog used by route payment middleware and discovery:

| Service ID | Method and path | Fixed price | Auth | Start here | Purpose |
| --- | --- | ---: | --- | --- | --- |
${catalogRows}

Marketplace ASP services are the available catalog records with registerOnOkx=true. Registration is independent of price: paid operations list with their fixed x402 price, and six free customer capabilities (mailbox list, message query, number release, number list, call get, call transcript) list as free A2MCP services. A free listing still requires the bearer token and still executes normally; it simply never returns HTTP 402. Webhooks, health checks, scheduler routes, internal worker routes, discovery endpoints, the event inbox and WebSocket upgrades are infrastructure and are not listed.

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
2. Save the AgentOS access token, phoneNumberId, and E.164 number. There is no callback secret: your Agent never exposes a webhook.
3. Open the live-voice WebSocket (see "Live voice protocol") and keep it authenticated for as long as the number should answer calls.
4. AgentPhone calls AgentOS. AgentOS verifies the provider HMAC and maps provider IDs to the owning tenant.
5. AgentOS sends one voice.turn to your connected socket and waits, briefly, for your voice.response.
6. Start outbound packages with call-1-minute or call-5-minutes. Extend an active call with extend-call-1-minute.
7. Prepay inbound time with add-inbound-minutes-10.
8. Query calls and transcripts through free authenticated reads.
9. Renew before entitlement expiry or release explicitly.

Purchase input:

~~~json
{
  "agentName": "support-agent",
  "areaCode": "415",
  "beginMessage": "Hello, how can I help?",
  "language": "en-US"
}
~~~

## Live voice protocol

The customer Agent is never required to expose a public webhook, and AgentOS never
calls a customer-supplied URL. Live calls flow one way only, outbound from your Agent:

    AgentPhone
      -> AgentOS provider webhook
      -> AgentOS live gateway
      -> customer Agent over WebSocket   (voice.turn)
      -> customer Agent response         (voice.response)
      -> AgentOS
      -> AgentPhone TTS/voice response

This is a different protocol from durable notifications, on the same socket:

| | Durable notification events | Synchronous live voice turns |
| --- | --- | --- |
| Message | event.delivery | voice.turn |
| Reply | event.ack | voice.response |
| Stored in v1_events | yes | no |
| Replayed after reconnect | yes | never |
| Deadline | none; leased and redelivered | strict, stated per turn |
| Missing it | redelivered later | safe fallback is spoken, call continues or ends |

A durable event is never sent in place of a live voice turn, and a live voice turn is
never persisted or replayed. Lifecycle events such as phone.call.ended remain durable
events and must still be acknowledged.

AgentOS -> Agent:

~~~json
{
  "type": "voice.turn",
  "turnId": "vt_...",
  "callId": "uuid",
  "phoneNumberId": "uuid",
  "providerCallId": "...",
  "direction": "inbound",
  "fromNumber": "+14155550123",
  "toNumber": "+14155550100",
  "transcript": "what the caller said",
  "deadline": "ISO-8601",
  "deadlineMs": 8000
}
~~~

Agent -> AgentOS, before the deadline:

~~~json
{ "type": "voice.response", "turnId": "vt_...", "text": "What the caller hears", "hangup": false }
~~~

To decline a turn and let AgentOS speak its fallback:

~~~json
{ "type": "voice.cancel", "turnId": "vt_..." }
~~~

If the deadline passes first, AgentOS sends voice.timeout for that turnId and a late
voice.response is rejected.

Rules enforced by the gateway:

- turnId correlates the turn; a response with an unknown turnId is rejected.
- A turn can be answered exactly once. The second voice.response is rejected.
- A response is accepted only from a socket authenticated for the same tenant, so one
  tenant can never answer another tenant's call.
- Responses are validated and bounded: text is at most 2000 characters, and only
  text, hangup, action and digits are forwarded. Anything else is dropped.
- Frames are capped at 256 KiB. Pending turns are bounded; unresolved turns cannot
  accumulate.

A live call fails safely, never silently, when no authenticated socket is connected,
the socket disconnects, the deadline passes, the response is invalid, the response
belongs to another tenant, call or turn, or the same turn is answered twice. In each
case AgentOS speaks a fallback line; an unreachable Agent ends the call, while a single
slow turn keeps it alive.

Only transcript text and text actions cross this boundary. AgentOS receives transcript
text from AgentPhone and returns text or an action; no raw audio is stored or exposed.

Outbound call:

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

The internal entitlement is exactly 30 days. US and Canada purchases and renewal are each fixed at 5.00 USDT. Durable jobs generate phone.number.expiring events 5, 3, and 1 days before expiry. Each event includes phoneNumberId, phone number, expiry, renewal deadline, fixed price, renewal endpoint, request body, and release warning.

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
   Replay always terminates. If the inbox is temporarily unreadable you receive a
   REPLAY_UNAVAILABLE error followed by session.replay.complete with replay:"deferred";
   nothing is lost, because unacknowledged events stay in the durable inbox and
   arrive on the next sweep, the next reconnect, or through POST /api/v1/events/list.
5. After durable processing send:

~~~json
{"type":"event.ack","eventId":"uuid"}
~~~

6. Receive event.acknowledged. Use POST /api/v1/events/ack if the socket acknowledgement is ambiguous.

The realtime token expires after 15 minutes. It is sent in the session.authenticate
message, never in the URL. Reconnect with a fresh token; replay resumes from the
durable inbox, so nothing is lost while disconnected.

One socket carries two distinct protocols. Route by message type:

- event.delivery / event.ack — durable notifications. Stored in v1_events, leased,
  replayed after reconnect, redelivered if the lease expires without an ack.
- voice.turn / voice.response / voice.cancel / voice.timeout — synchronous live voice.
  Never stored, never replayed, always deadline-bound. See "Live voice protocol".

session.ready advertises both under "protocols". Acknowledging a voice turn with
event.ack, or answering a durable event with voice.response, is a protocol error.

The no-expiry at_v1 API credential and short-lived realtime credential are intentionally different. Never put an API token in a WebSocket URL or log it.

## Domain flow

Domain is unavailable and is not close to production. POST /api/v1/domains/register returns HTTP 503 immediately: it issues no x402 challenge, creates and settles no payment, and contacts no registrar. The catalog record is available=false, paid=false, x402Price=null, registerOnOkx=false, startHere=false.

Cloudflare-backed domain support is planned. It is not implemented, and no date is committed. Do not build against this endpoint, do not send payment, and do not register domain.register on OKX.

An unused legacy Namecheap adapter remains in the tree. It is unreachable from v1 and its configuration is not a step toward enabling Domain.

## Scheduling and workers

Vercel Cron is a production-deployment scheduler that invokes a Vercel Function. It is not a queue or long-running worker. The repository config uses one daily 03:00 UTC safety sweep, compatible with Vercel Hobby's once-daily limit. The route performs one short, idempotent batch.

The continuously running services/durable-worker process invokes short batches every five seconds for call deadlines, provider retries, releases, and reconciliation. v1_jobs is the durable source of truth; jobs use leases, SKIP LOCKED, bounded exponential backoff, and dead state. The realtime gateway is also a separate continuously running WebSocket service because Vercel Functions do not host persistent WebSocket servers.

Vercel Pro is required only if Vercel itself must invoke cron more than daily. It does not remove the need for the separate worker for sub-minute call enforcement.

## Errors and recovery

- ONBOARDING_REQUIRED: this wallet has no AgentOS tenant yet. Pay the returned startHere endpoint from this same wallet; the tenant is created there and subsequent paid calls on the same wallet are recognized automatically (no bearer needed).
- AUTH_REQUIRED: provide a valid at_v1 token or start with provisioning.
- INVALID_TOKEN: obtain/use the correct non-revoked token.
- FORBIDDEN / RESOURCE_NOT_OWNED: never substitute a tenant ID; use a resource owned by this token.
- PAYMENT_REQUIRED: quote, confirm, pay, and replay the identical request.
- PAYMENT_PENDING: do not submit a second payment; poll/retry unchanged.
- PAYMENT_REPLAY_CONFLICT: this proof paid for a different request; pay for the new operation separately.
- RESOURCE_NOT_FOUND: refresh owned resources; do not guess IDs.
- PROVIDER_TEMPORARY_FAILURE: retry the same operation with the same key/proof after backoff.
- ALLOWANCE_EXHAUSTED: buy inbound minutes before accepting more inbound speech.
- NUMBER_EXPIRING: renew through phone.number.renew.30d.
- NUMBER_RELEASED: the number is irreversible; buy a new number.

## Deployment and security

Apply migrations in timestamp order and run Supabase security/performance advisors. v1 server access uses only SUPABASE_SERVICE_ROLE_KEY; browser roles receive no table grants except the legacy Realtime policy retained for migration compatibility. The connected legacy tables must have RLS enabled and anon/authenticated grants revoked.

Required groups: APP_URL; OKX credentials and payment wallet; Supabase URL/service role; Resend API/webhook/domain; AgentPhone API/base URL; PHONE_SECRET_ENCRYPTION_KEY; CRON_SECRET; REALTIME_GATEWAY_URL, REALTIME_GATEWAY_JWT_SECRET and REALTIME_GATEWAY_INTERNAL_URL/REALTIME_GATEWAY_INTERNAL_SECRET for the live-voice broker hop; AGENTOS_APP_URL for the worker; DASHBOARD_SESSION_SECRET; private admin Basic credentials. Every canonical public URL comes from configuration; no deployment domain is hardcoded. Domain variables remain unset.

Dashboard paths use a wallet-signature HttpOnly owner session and are not an agent auth surface. The separate /admin path uses operator Basic Auth. Provider webhooks and internal worker routes are infrastructure, not marketplace services.
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
- Every secondary endpoint can be reached in two ways: send that bearer credential, or simply pay from the same wallet — AgentOS resolves the tenant from the x402-verified payer wallet, so the OKX buyer flow (which cannot attach custom headers) still works end to end. Only a request from a wallet that has never provisioned anything, and no bearer, returns HTTP 428 ONBOARDING_REQUIRED before any payment settlement.

## Authentication

Wallet/payer identity creates the tenant boundary. First send the provisioning body, receive PAYMENT-REQUIRED, use an OKX x402 quote/pay flow with explicit payer approval, and replay the identical request with PAYMENT-SIGNATURE. Save the returned at_v1 access token. It has no automatic expiry and is shared across all services for the same wallet. Every paid endpoint has an independent fixed charge.

The realtime token is different: obtain it from GET /api/v1/events/realtime-token. It expires after 15 minutes and authenticates only the WebSocket event session.

## Service Catalog

${machineCatalog}

## Email Flow

Create mailbox → save access token → send/list/read → connect WebSocket → handle email.received safe summary → fetch full message with emailId → POST /api/v1/events/ack.

Create body: {"localPart":"research-agent","displayName":"Research Agent"}
Send body: {"mailboxId":"uuid","to":["recipient@example.com"],"subject":"Subject","text":"Body"}

## Phone Flow

Buy number for 5.00 USDT / 30 days → save token and phoneNumberId → connect the live-voice WebSocket → answer voice.turn with voice.response before the deadline → buy outbound call packages or inbound allowance → monitor phone.number.expiring → renew for 5.00 USDT / 30 days → release safely when no longer needed.

Buy body: {"agentName":"support-agent","areaCode":"415"}
No customer webhook and no callback secret. Live calls are answered over the WebSocket; see the live voice protocol.
Call body: {"phoneNumberId":"uuid","toNumber":"+14155550123"}
Renew body: {"phoneNumberId":"uuid"}
Release body: {"phoneNumberId":"uuid","confirmRelease":true}

Recordings are never enabled or exposed. Use transcripts.

## Domain Flow

Unavailable. POST /api/v1/domains/register returns 503 with no payment challenge and no registrar call. Cloudflare-backed support is planned but not implemented. available=false means do not pay and do not register the service on OKX.

## Event Delivery

WebSocket gives immediate delivery; Supabase v1_events is the durable inbox. Authenticate the socket with session.authenticate; wait for session.ready; process event.delivery in order; send event.ack after durable local handling. On reconnect the gateway replays unacknowledged non-expired events. REST recovery: POST /api/v1/events/list, /get, /ack, /ack-all.

Email events contain IDs/from/subject/time, not body or attachments. Supported events are documented in /docs; AgentOS internal events identify their source.

## Errors and Recovery

- ONBOARDING_REQUIRED: call error.startHere; do not pay the failed request.
- AUTH_REQUIRED or INVALID_TOKEN: use the correct at_v1 token.
- PAYMENT_REQUIRED: quote, confirm, pay, replay unchanged.
- PAYMENT_PENDING: do not pay twice.
- PAYMENT_REPLAY_CONFLICT: the proof belongs to another request; pay separately for a new operation.
- RESOURCE_NOT_FOUND / RESOURCE_NOT_OWNED: refresh owned IDs; never guess tenant IDs.
- PROVIDER_TEMPORARY_FAILURE: retry unchanged with backoff.
- ALLOWANCE_EXHAUSTED: buy inbound allowance.
- NUMBER_EXPIRING: renew now.
- NUMBER_RELEASED: buy a new number.

## Safe Retries

No idempotency header is required or accepted. Retry an ambiguous paid request by replaying it byte-for-byte with the same PAYMENT-SIGNATURE. The proof settles at most once and the stored response is returned, so a retry never provisions a second resource or charges twice.

## Fixed Pricing

Public prices come only from the AgentOS service catalog and do not change automatically with provider pricing.

## Complete example

1. GET /api/v1/services/email.mailbox.create.
2. POST the mailbox body; receive 402.
3. Quote/pay with explicit approval and replay with PAYMENT-SIGNATURE.
4. Save authentication.accessToken.
5. GET /api/v1/events/realtime-token with Authorization: Bearer at_v1_...
6. Connect to websocketUrl and send {"type":"session.authenticate","token":"..."}.
7. On email.received, GET /api/v1/email/messages/query?messageId=... with the bearer token.
8. POST /api/v1/events/ack with {"eventId":"..."}.
`
