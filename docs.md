# AgentOS v1 operational API guide

This is the source-controlled guide for autonomous agents and operators. The deployed canonical resources are `/docs`, `/llms.txt`, `/api/v1/services`, and `/openapi.json`.

## Owner dashboard and private administration

`/dashboard` is the public wallet-owner portal. The owner connects an injected EVM wallet through RainbowKit and signs an expiring, one-time AgentOS message. The server verifies that signature and creates a 12-hour HttpOnly browser session. Every dashboard database query and action is scoped to the tenant belonging to that exact wallet.

The dashboard never asks the owner to paste an existing `at_v1_…` token. Its **Agent tokens** page can issue a new permanent server-to-server token after the wallet has created its first resource. The plaintext secret is shown exactly once; AgentOS persists only its SHA-256 hash. Revocation is wallet-session authenticated.

`/admin` is separate operator-only tooling, protected by `ADMIN_DASHBOARD_USERNAME` and `ADMIN_DASHBOARD_PASSWORD`. It shows cross-tenant operational totals; it must never be shared with Agents or customers.

AgentOS is an OKX.AI REST ASP. It uses real Resend and AgentPhone provider calls, fixed AgentOS catalog prices, wallet-based tenant ownership, and OKX x402 per paid operation. It is not MCP and never returns a mocked provider success.

## Discovery and onboarding

Free, unauthenticated discovery:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/v1` | API identity, authentication rules, compact catalog |
| GET | `/api/v1/services` | Canonical service catalog |
| GET | `/api/v1/services/{serviceId}` | One service contract |
| GET | `/openapi.json` | OpenAPI 3.1 |
| GET | `/llms.txt` | Machine-oriented lifecycle guide |
| GET | `/docs` | Deployed operational guide |

Available first provisioning calls:

| Service ID | Method and path | Fixed price |
| --- | --- | ---: |
| `email.mailbox.create` | POST `/api/v1/email/mailboxes` | 0.25 USDT |
| `phone.number.us.30d` | POST `/api/v1/phone/purchase-us-number-30-days` | 7.00 USDT |
| `phone.number.ca.30d` | POST `/api/v1/phone/purchase-canada-number-30-days` | 7.00 USDT |

`domain.register` exists only as a fail-closed 503 route. It never requests or settles payment until fixed per-TLD services and stable registrar egress are ready.

Calling any secondary paid endpoint without a token returns HTTP 428:

```json
{
  "error": {
    "code": "ONBOARDING_REQUIRED",
    "message": "Create your first AgentOS resource before using this service.",
    "service": "phone",
    "startHere": {
      "serviceId": "phone.number.us.30d",
      "endpoint": "/api/v1/phone/purchase-us-number-30-days",
      "method": "POST",
      "price": "7.00",
      "currency": "USDT",
      "requiredInput": {
        "agentName": "Agent name",
        "agentWebhookUrl": "Public HTTPS live-agent callback URL"
      }
    }
  },
  "payment": {
    "settled": false,
    "instruction": "Do not create or submit a payment for this response."
  }
}
```

## Authentication and x402

There is no `/auth/token` charge.

1. Send a start-here POST body without `Authorization`.
2. Receive HTTP 402 and `PAYMENT-REQUIRED`.
3. Use an OKX Agent Payments Protocol client to quote, present the payment for explicit approval, pay, and replay.
4. Replay the identical method, URL, and JSON with `PAYMENT-SIGNATURE` and `Idempotency-Key`.
5. AgentOS verifies the payer, binds the proof to the request, settles once, performs the provider operation, then returns `data.authentication.accessToken`.
6. Store the `at_v1_...` token. It has no automatic expiry.
7. Reuse it for every AgentOS service owned by the same payer wallet. Each later paid endpoint still requires its own fixed payment.

Secondary paid requests are authenticated and resource ownership is checked before payment preparation where a mailbox, phone number, or call ID is available. The x402 payer must match the token wallet.

Paid curl skeleton:

```bash
curl -X POST "$AGENTOS_URL/api/v1/phone/call-1-minute" \
  -H "Authorization: Bearer $AGENTOS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: call-2026-001" \
  -H "PAYMENT-SIGNATURE: $PAYMENT_SIGNATURE" \
  -d '{"phoneNumberId":"uuid","toNumber":"+14155550123"}'
```

Never submit a second payment after an ambiguous response. Retry the identical request with the same proof and idempotency key.

## Canonical public service inventory

The machine-authoritative form is `GET /api/v1/services`. Paid marketplace candidates are the available catalog records with `registerOnOkx=true`.

### Email

| Service ID | Method and path | Price | Auth | Start here |
| --- | --- | ---: | --- | --- |
| `email.mailbox.create` | POST `/api/v1/email/mailboxes` | 0.25 | x402 bootstrap | yes |
| `email.mailbox.list` | GET `/api/v1/email/mailboxes/query` | free | bearer | no |
| `email.mailbox.update` | POST `/api/v1/email/mailboxes/update` | 0.01 | bearer + x402 | no |
| `email.mailbox.delete` | POST `/api/v1/email/mailboxes/delete` | 0.01 | bearer + x402 | no |
| `email.message.send` | POST `/api/v1/email/messages/send` | 0.02 | bearer + x402 | no |
| `email.message.query` | GET `/api/v1/email/messages/query` | free | bearer | no |

Create mailbox:

```json
{
  "localPart": "research-agent",
  "displayName": "Research Agent",
  "outboundSignature": "optional"
}
```

Send:

```json
{
  "mailboxId": "uuid",
  "to": ["recipient@example.com"],
  "subject": "Subject",
  "text": "Plain text",
  "html": "<p>Optional HTML</p>"
}
```

Query all or one:

```text
GET /api/v1/email/messages/query?mailboxId=<uuid>&limit=50
GET /api/v1/email/messages/query?messageId=<uuid>
```

The verified Resend webhook fetches inbound content, matches all active recipient mailboxes, stores one tenant-owned message per mailbox, and writes a safe `email.received` event. The event includes IDs, sender, subject, and time—not body or attachments. Fetch the complete message with `messageId`.

### Phone

| Service ID | Method and path | Price | Auth | Start here |
| --- | --- | ---: | --- | --- |
| `phone.number.us.30d` | POST `/api/v1/phone/purchase-us-number-30-days` | 7.00 | x402 bootstrap | yes |
| `phone.number.ca.30d` | POST `/api/v1/phone/purchase-canada-number-30-days` | 7.00 | x402 bootstrap | yes |
| `phone.number.renew.30d` | POST `/api/v1/phone/renew-number-30-days` | 5.00 | bearer + x402 | no |
| `phone.call.outbound.1m` | POST `/api/v1/phone/call-1-minute` | 0.30 | bearer + x402 | no |
| `phone.call.outbound.5m` | POST `/api/v1/phone/call-5-minutes` | 1.50 | bearer + x402 | no |
| `phone.call.extend.1m` | POST `/api/v1/phone/extend-call-1-minute` | 0.30 | bearer + x402 | no |
| `phone.call.inbound.add.10m` | POST `/api/v1/phone/add-inbound-minutes-10` | 3.00 | bearer + x402 | no |
| `phone.number.release` | POST `/api/v1/phone/release-number` | free | bearer | no |
| `phone.number.list` | GET `/api/v1/phone/numbers` | free | bearer | no |
| `phone.call.get` | GET `/api/v1/phone/calls/{callId}` | free | bearer | no |
| `phone.call.transcript` | GET `/api/v1/phone/calls/{callId}/transcript` | free | bearer | no |

Purchase:

```json
{
  "agentName": "support-agent",
  "agentWebhookUrl": "https://agent.example.com/voice",
  "areaCode": "415",
  "beginMessage": "Hello, how can I help?",
  "language": "en-US"
}
```

The response contains the AgentOS `phoneNumberId`, E.164 number, entitlement dates, and a one-time callback verification secret. AgentOS creates a real AgentPhone webhook-mode agent and number.

AgentPhone sends signed live events to `/api/v1/webhooks/agentphone`. AgentOS verifies provider HMAC, strips recording/media URL fields, resolves the exact tenant, and forwards the event to the supplied callback with:

```text
X-AgentOS-Timestamp: unix-seconds
X-AgentOS-Signature: sha256=HMAC_SHA256(callbackSecret, timestamp + "." + exactRawJson)
```

For `agent.message`, the external agent responds dynamically:

```json
{"text":"The live response"}
```

or:

```json
{"hangup":true}
```

Recording is out of scope. No recording controls, endpoints, URLs, or prices are exposed. Only transcripts are available.

AgentPhone account model: AgentOS currently uses one operator billing account for all customers. The provider API key never leaves the server. Provider number/agent/call IDs are uniquely mapped to one wallet tenant and every operation verifies that mapping. AgentPhone sub-accounts are optional extra isolation but are not a scalable one-per-agent boundary because the provider currently limits a master account to 25.

### Number renewal

Internal entitlement duration is exactly 30 days. Events are scheduled 5, 3, and 1 days before expiry. Renew with:

```json
{"phoneNumberId":"uuid"}
```

Each `phone.number.expiring` event contains the ID, E.164 number, expiry, renewal deadline, fixed 5.00 USDT price, renewal endpoint, required request body, and irreversible-release warning.

AgentPhone provider numbers renew from the shared account balance and currently expose no explicit renew API or authoritative next-renewal timestamp. AgentOS extends its own paid entitlement, reconciles provider active state, blocks expired use, and attempts provider deletion at the internal deadline. Exact deletion versus an external renewal charge cannot be transactional at the boundary.

## Durable events REST API

All event endpoints are free and bearer-authenticated:

| Service ID | Method and path | Input |
| --- | --- | --- |
| `events.list` | POST `/api/v1/events/list` | filters/cursor |
| `events.get` | POST `/api/v1/events/get` | `eventId` |
| `events.ack` | POST `/api/v1/events/ack` | `eventId` |
| `events.ack-all` | POST `/api/v1/events/ack-all` | `before`, optional filters |
| `events.realtime-token` | GET `/api/v1/events/realtime-token` | none |

List:

```json
{
  "status": "pending",
  "types": ["email.received", "phone.number.expiring"],
  "agentId": "optional",
  "service": "email",
  "resourceId": "optional",
  "from": "2026-07-01T00:00:00Z",
  "to": "2026-08-01T00:00:00Z",
  "limit": 50,
  "cursor": "optional opaque cursor"
}
```

Ack is idempotent:

```json
{"eventId":"uuid"}
```

Ack all requires an explicit cutoff:

```json
{
  "before": "2026-07-24T12:00:00Z",
  "types": ["email.received"],
  "service": "email"
}
```

Statuses: `pending`, `delivered`, `acknowledged`, `expired`, `failed`. `deliveredAt` and `acknowledgedAt` are separate. Expired events are not replayed. Important events remain auditable after acknowledgement.

Compatibility aliases remain: `GET /api/v1/events` and `POST /api/v1/events/{eventId}/acknowledge`.

## WebSocket protocol

Get a 15-minute token:

```bash
curl "$AGENTOS_URL/api/v1/events/realtime-token" \
  -H "Authorization: Bearer $AGENTOS_TOKEN"
```

Connect to `realtime.websocketUrl`, then authenticate:

```json
{"type":"session.authenticate","token":"realtime JWT"}
```

Server sequence:

```json
{"type":"session.ready","tenantScoped":true,"replay":"starting"}
{"type":"event.delivery","event":{"eventId":"uuid","type":"email.received"}}
{"type":"session.replay.complete"}
```

After durable local handling:

```json
{"type":"event.ack","eventId":"uuid"}
```

The gateway claims events with a database lease, updates delivery state but not acknowledgement, and replays an unacknowledged event after a lost connection/expired lease. Use REST ack when socket outcome is ambiguous.

JavaScript:

```js
const tokenResponse = await fetch(`${base}/api/v1/events/realtime-token`, {
  headers: { Authorization: `Bearer ${accessToken}` },
}).then((response) => response.json())

const ws = new WebSocket(tokenResponse.data.realtime.websocketUrl)
ws.addEventListener("open", () => ws.send(JSON.stringify({
  type: "session.authenticate",
  token: tokenResponse.data.realtime.token,
})))
ws.addEventListener("message", async ({ data }) => {
  const message = JSON.parse(data)
  if (message.type !== "event.delivery") return
  await handleDurably(message.event)
  ws.send(JSON.stringify({ type: "event.ack", eventId: message.event.eventId }))
})
```

Python:

```python
import asyncio, json, websockets

async def events(websocket_url, realtime_token):
    async with websockets.connect(websocket_url) as ws:
        await ws.send(json.dumps({
            "type": "session.authenticate",
            "token": realtime_token,
        }))
        async for raw in ws:
            message = json.loads(raw)
            if message.get("type") == "event.delivery":
                await handle_durably(message["event"])
                await ws.send(json.dumps({
                    "type": "event.ack",
                    "eventId": message["event"]["eventId"],
                }))
```

## Internal infrastructure—not ASP services

- POST `/api/v1/webhooks/resend`: verified Resend ingress.
- POST `/api/v1/webhooks/agentphone`: verified AgentPhone ingress and live voice relay.
- GET/POST `/api/v1/internal/phone-worker`: `CRON_SECRET`-protected short batch.
- `wss://.../v1/events`: WebSocket upgrade served by the separate gateway.
- Gateway `/health`.
- `/dashboard/**` and `/api/dashboard/**`: wallet-signature owner portal and its session-authenticated internal routes.
- `/admin/**`: operator-only Basic-auth administration.

These must not be registered as OKX.AI paid services.

## Scheduling

`vercel.json` runs one daily 03:00 UTC safety sweep, which fits Vercel Hobby. Hobby cron is only once daily and may run anywhere within the selected hour. Pro supports every-minute schedules, but call deadlines and retry-heavy work still belong in a separate continuously running worker.

`services/durable-worker/worker.mjs` calls one short, idempotent batch every five seconds. Durable state is in `v1_jobs`, not memory. Jobs use `FOR UPDATE SKIP LOCKED`, leases, bounded retries, and dead state.

`services/realtime-gateway/server.mjs` hosts persistent WebSockets and listens for event inserts. Deploy it to infrastructure that supports long-lived connections. Do not deploy it as a Vercel Function.

## Database and migrations

Apply in timestamp order:

1. `20260723_agentos_v1.sql`
2. `20260724064040_agentphone_phone_lifecycle.sql`
3. `20260724150000_unified_durable_events.sql`
4. `20260724160000_foreign_key_indexes.sql`
5. `20260724170000_gateway_only_event_access.sql`

The last migration adds event statuses, expiry, delivery leases/attempts, tenant/agent/type/resource indexes, the atomic event claim function, mailbox-scoped Resend uniqueness, and explicit hardening of named legacy tables. It does not delete data.

The connected `agentmail` database now contains the legacy migration plus all five v1 migrations. All 21 public tables have RLS enabled; `anon/authenticated` have no direct public-table grants; event/job claim functions are service-role-only. Security advisors have no ERROR/WARN findings. Remaining INFO notices are expected deny-all RLS tables and unused indexes on empty v1 tables.

## Environment variables

Application:

- `APP_URL`
- `ADMIN_DASHBOARD_USERNAME`, `ADMIN_DASHBOARD_PASSWORD`

Supabase:

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Payments:

- `PAYMENT_REQUIRED=true`
- `PAYMENT_WALLET`
- `OKX_API_KEY`, `OKX_SECRET_KEY`, `OKX_PASSPHRASE`

Email:

- `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `EMAIL_DOMAIN`

Phone:

- `AGENTPHONE_API_KEY`, `AGENTPHONE_BASE_URL`
- `PHONE_SECRET_ENCRYPTION_KEY` (32 random bytes, base64)

Worker/realtime:

- `CRON_SECRET`
- `REALTIME_GATEWAY_URL`
- `REALTIME_GATEWAY_JWT_SECRET`
- worker-only `AGENTOS_APP_URL`, optional `WORKER_INTERVAL_MS`

Domain (disabled until ready):

- `NAMECHEAP_API_USER`, `NAMECHEAP_API_KEY`, `NAMECHEAP_USERNAME`
- `NAMECHEAP_CLIENT_IP`, `NAMECHEAP_SANDBOX`
- `DOMAIN_CONTACT_ENCRYPTION_KEY`

## Local development and deployment

```bash
npm install
npm run dev
npm run realtime-gateway
npm run durable-worker
npm run lint
npm run typecheck
npm test
npm run build
```

Application deploy:

1. Link the actual repository to a Vercel project.
2. Configure server-only secrets and `CRON_SECRET`.
3. Deploy production; cron only activates on production deployments.
4. Verify `/api/v1`, `/api/v1/services`, `/openapi.json`, `/llms.txt`, and `/docs`.

Gateway/worker:

1. Deploy each as a long-running Node process.
2. Use a `wss://` gateway URL.
3. Give the gateway only Supabase URL/service role and realtime signing secret.
4. Give the worker only app URL and cron secret.
5. Add health, restart, latency, dead-job, and invocation-gap alerts.

Provider setup:

- Resend webhook: `https://APP_URL/api/v1/webhooks/resend`.
- AgentPhone webhooks are configured during phone provisioning.
- Namecheap requires a stable allowlisted public IPv4 before Domain can be enabled.

## Errors and recovery

| Code | Action |
| --- | --- |
| `ONBOARDING_REQUIRED` | Call returned `startHere`; do not pay current request |
| `AUTH_REQUIRED` / `INVALID_TOKEN` | Supply correct, non-revoked `at_v1` token |
| `FORBIDDEN` / `RESOURCE_NOT_OWNED` | Use a resource owned by this wallet token |
| `PAYMENT_REQUIRED` | Quote, confirm, pay, replay unchanged |
| `PAYMENT_PENDING` | Poll/retry unchanged; do not pay twice |
| `IDEMPOTENCY_CONFLICT` | Restore original body or use a new key for a new operation |
| `RESOURCE_NOT_FOUND` | Refresh owned resource IDs |
| `PROVIDER_TEMPORARY_FAILURE` | Back off and retry the exact request/key/proof |
| `ALLOWANCE_EXHAUSTED` | Buy inbound minutes |
| `NUMBER_EXPIRING` | Renew through `phone.number.renew.30d` |
| `NUMBER_RELEASED` | Buy a new number; release is irreversible |

## Security notes

- Access tokens are stored as SHA-256 hashes.
- Caller-supplied tenant IDs are never trusted.
- Every server resource query includes tenant ownership.
- Provider IDs have uniqueness constraints.
- v1 browser roles do not receive broad table access.
- Realtime credentials are short-lived and separate from API credentials.
- WebSocket tokens are sent in an authentication message, not in URLs.
- Provider and callback secrets are encrypted at rest.
- Recordings are stripped and never exposed.
- Owner dashboard wallet sessions, operator Basic Auth, and agent bearer tokens are three separate authentication surfaces.
