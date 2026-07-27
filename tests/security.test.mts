import assert from "node:assert/strict"
import { createHmac, randomBytes } from "node:crypto"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"

const root = process.cwd()
const read = (path: string) => readFileSync(join(root, path), "utf8")

process.env.PHONE_SECRET_ENCRYPTION_KEY ??= randomBytes(32).toString("base64")
process.env.REALTIME_GATEWAY_JWT_SECRET ??= "r".repeat(48)

const { verifyAgentPhoneWebhook, stripProviderMediaFields } = await import("../src/lib/v1/agentphone.ts")
const { encryptPhoneSecret, decryptPhoneSecret } = await import("../src/lib/v1/secrets.ts")
const { issueRealtimeToken, verifyRealtimeToken } = await import("../src/lib/v1/events.ts")
const { requestHash } = await import("../src/lib/v1/idempotency.ts")

function agentPhoneHeaders(body: string, secret: string, timestamp = String(Math.floor(Date.now() / 1000))) {
  return new Headers({
    "x-webhook-id": "wh_1",
    "x-webhook-timestamp": timestamp,
    "x-webhook-signature": `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`,
  })
}

test("AgentPhone webhook signatures are verified, not trusted", () => {
  const secret = "provider-secret"
  const body = JSON.stringify({ event: "agent.message", channel: "voice" })

  assert.equal(verifyAgentPhoneWebhook(body, agentPhoneHeaders(body, secret), secret), "wh_1")

  assert.throws(
    () => verifyAgentPhoneWebhook(body, agentPhoneHeaders(body, "wrong-secret"), secret),
    /Invalid AgentPhone webhook signature/,
    "a forged signature is rejected",
  )
  assert.throws(
    () => verifyAgentPhoneWebhook(`${body} `, agentPhoneHeaders(body, secret), secret),
    /Invalid AgentPhone webhook signature/,
    "a tampered body is rejected",
  )
  assert.throws(
    () => verifyAgentPhoneWebhook(body, new Headers({ "x-webhook-id": "wh_1" }), secret),
    /Missing AgentPhone webhook authentication/,
  )
})

test("AgentPhone webhooks outside the replay window are rejected", () => {
  const secret = "provider-secret"
  const body = "{}"
  const stale = String(Math.floor(Date.now() / 1000) - 3_600)
  assert.throws(
    () => verifyAgentPhoneWebhook(body, agentPhoneHeaders(body, secret, stale), secret),
    /Stale AgentPhone webhook/,
  )
  const future = String(Math.floor(Date.now() / 1000) + 3_600)
  assert.throws(
    () => verifyAgentPhoneWebhook(body, agentPhoneHeaders(body, secret, future), secret),
    /Stale AgentPhone webhook/,
  )
})

test("provider recording and audio fields are stripped before anything is stored", () => {
  const stripped = stripProviderMediaFields({
    callId: "c1",
    recordingUrl: "https://provider.example/audio.mp3",
    recording_url: "https://provider.example/audio.mp3",
    audioUrl: "https://provider.example/a.wav",
    audio_url: "https://provider.example/a.wav",
    transcripts: [{ transcript: "hello", recordingUrl: "https://provider.example/x.mp3" }],
  }) as Record<string, unknown>

  assert.equal(stripped.callId, "c1")
  assert.equal("recordingUrl" in stripped, false)
  assert.equal("recording_url" in stripped, false)
  assert.equal("audioUrl" in stripped, false)
  assert.equal("audio_url" in stripped, false)
  const nested = (stripped.transcripts as Array<Record<string, unknown>>)[0]
  assert.equal(nested.transcript, "hello", "transcripts survive")
  assert.equal("recordingUrl" in nested, false, "nested recordings are stripped too")
})

test("provider secrets round-trip encrypted and are tamper-evident at rest", () => {
  const secret = "whsec_provider_example"
  const sealed = encryptPhoneSecret(secret)
  assert.notEqual(sealed, secret, "the secret is not stored in plaintext")
  assert.doesNotMatch(sealed, /whsec_provider_example/)
  assert.equal(decryptPhoneSecret(sealed), secret)

  const packed = Buffer.from(sealed, "base64")
  packed[packed.length - 1] ^= 0xff
  assert.throws(() => decryptPhoneSecret(packed.toString("base64")), /cannot be decrypted/)
})

test("realtime tokens are tenant-scoped, signed, and expire in 15 minutes", () => {
  const tenant = { id: "11111111-1111-1111-1111-111111111111", walletAddress: "0xabc" }
  const issued = issueRealtimeToken(tenant)

  assert.ok(issued.token, "a token is returned")
  assert.ok(issued.websocketUrl, "the WebSocket URL is returned")
  assert.ok(issued.expiresAt, "the expiry is returned")
  assert.ok(issued.protocol, "protocol instructions are returned")

  const lifetimeSeconds = (Date.parse(issued.expiresAt) - Date.now()) / 1_000
  assert.ok(lifetimeSeconds > 14 * 60 && lifetimeSeconds <= 15 * 60, "expiry is 15 minutes")

  const claims = verifyRealtimeToken(issued.token)
  assert.equal(claims?.tenantId, tenant.id, "the token binds exactly one tenant")

  const [header, payload] = issued.token.split(".")
  assert.equal(verifyRealtimeToken(`${header}.${payload}.forged`), null, "a forged signature fails")

  const other = issueRealtimeToken({ id: "22222222-2222-2222-2222-222222222222", walletAddress: "0xdef" })
  assert.notEqual(verifyRealtimeToken(other.token)?.tenantId, tenant.id, "tokens do not cross tenants")
})

test("an expired realtime token is refused", () => {
  const base64url = (value: string) => Buffer.from(value).toString("base64url")
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))
  const payload = base64url(JSON.stringify({
    aud: "agentos-realtime",
    sub: "11111111-1111-1111-1111-111111111111",
    exp: Math.floor(Date.now() / 1000) - 60,
  }))
  const signature = createHmac("sha256", process.env.REALTIME_GATEWAY_JWT_SECRET!)
    .update(`${header}.${payload}`)
    .digest("base64url")
  assert.equal(verifyRealtimeToken(`${header}.${payload}.${signature}`), null)
})

test("a realtime token for the wrong audience is refused", () => {
  const base64url = (value: string) => Buffer.from(value).toString("base64url")
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))
  const payload = base64url(JSON.stringify({
    aud: "something-else",
    sub: "11111111-1111-1111-1111-111111111111",
    exp: Math.floor(Date.now() / 1000) + 600,
  }))
  const signature = createHmac("sha256", process.env.REALTIME_GATEWAY_JWT_SECRET!)
    .update(`${header}.${payload}`)
    .digest("base64url")
  assert.equal(verifyRealtimeToken(`${header}.${payload}.${signature}`), null)
})

test("payment proofs bind to the exact request body", () => {
  const body = { mailboxId: "m1", to: ["a@example.com"], subject: "Hi", text: "Body" }
  assert.equal(requestHash(body), requestHash({ ...body }), "an identical retry matches")
  assert.notEqual(requestHash(body), requestHash({ ...body, to: ["attacker@example.com"] }))
  assert.notEqual(requestHash(body), requestHash({ ...body, subject: "Hi " }))
})

test("a paid request binds its proof to endpoint, body and idempotency key", () => {
  const route = read("src/lib/v1/route.ts")
  const binding = route.slice(route.indexOf('payment.kind === "settled"'))
  assert.match(binding, /payment\.endpoint !== endpoint/)
  assert.match(binding, /payment\.idempotencyKey !== idempotencyKey/)
  assert.match(binding, /payment\.requestHash !== bodyHash/)
  assert.match(binding, /payment_replay_conflict/)
  // A second proof cannot be swapped onto an in-flight key.
  assert.match(route, /idempotency_payment_conflict/)
})

test("the payer wallet must match the access-token tenant", () => {
  const auth = read("src/lib/v1/auth.ts")
  assert.match(auth, /export function assertPaymentTenant/)
  assert.match(auth, /wallet !== tenant\.walletAddress/)
  assert.match(auth, /403/)
  const route = read("src/lib/v1/route.ts")
  assert.match(route, /assertPaymentTenant\(existingTenant, payment\.payer\)/)
})

test("resource ownership is checked before payment is prepared", () => {
  const route = read("src/lib/v1/route.ts")
  const ownership = route.indexOf("preflightOwnedResource(existingTenant")
  const prepare = route.indexOf("prepareV1Payment(request")
  assert.ok(ownership > 0 && prepare > 0)
  assert.ok(ownership < prepare, "ownership must be verified before a payment is created")
  assert.match(route, /RESOURCE_NOT_OWNED/)
  assert.match(read("src/lib/v1/route.ts"), /\.eq\("tenant_id", tenant\.id\)/)
})

test("every tenant-facing phone query is scoped to the tenant", () => {
  const phone = read("src/lib/v1/phone.ts")
  for (const table of ["v1_phone_numbers", "v1_calls"]) {
    const reads = phone.split(`.from("${table}")`).slice(1)
    for (const fragment of reads) {
      const statement = fragment.slice(0, 600)
      assert.match(statement, /tenant_id/, `an unscoped ${table} query exists`)
    }
  }
})

test("provider webhooks are deduplicated by provider event ID", () => {
  for (const path of [
    "src/app/api/v1/webhooks/agentphone/route.ts",
    "src/app/api/v1/webhooks/resend/route.ts",
  ]) {
    const route = read(path)
    assert.match(route, /v1_webhook_events/, `${path} records the provider event`)
    assert.match(route, /23505/, `${path} treats a duplicate insert as a duplicate delivery`)
    assert.match(route, /duplicate: true/, `${path} reports the duplicate instead of reprocessing`)
    assert.match(route, /processed_at/, `${path} only skips events it already finished`)
  }
  // The dedupe depends on a real uniqueness constraint, not just application code.
  const migration = read("supabase/migrations/20260724105651_agentos_v1.sql")
  assert.match(migration, /v1_webhook_events/)
  assert.match(migration, /unique\s*\(\s*provider\s*,\s*provider_event_id\s*\)|provider,\s*provider_event_id/)
})

test("the internal worker endpoint requires the CRON secret", () => {
  const route = read("src/app/api/v1/internal/phone-worker/route.ts")
  assert.match(route, /CRON_SECRET/)
  assert.match(route, /401|403/, "an unauthenticated caller is refused")
})

test("worker jobs are leased with skip locked and retried with backoff", () => {
  const migration = read("supabase/migrations/20260724105706_agentphone_phone_lifecycle.sql")
  assert.match(migration, /for update skip locked/i, "claims must not double-process a job")
  assert.match(migration, /lease_expires_at/, "a lease can expire and be reclaimed")

  const jobs = read("src/lib/v1/jobs.ts")
  assert.match(jobs, /attempts >= job\.max_attempts/, "a job eventually stops retrying")
  assert.match(jobs, /Math\.min\(300, Math\.max\(5, 2 \*\* Math\.min\(job\.attempts, 8\)\)\)/, "retries back off")
  assert.match(jobs, /lease_expires_at: null/, "a finished job releases its lease")
})

test("durable events lease, redeliver and acknowledge explicitly", () => {
  const migration = read("supabase/migrations/20260724105725_unified_durable_events.sql")
  assert.match(migration, /for update skip locked/i)
  assert.match(migration, /delivery_lease/)
  assert.match(migration, /'pending', 'delivered', 'acknowledged', 'expired', 'failed'/)

  const gateway = read("services/realtime-gateway/server.mjs")
  assert.match(gateway, /v1_claim_events_for_delivery/)
  assert.match(gateway, /session\.replay\.complete/, "replay completion is signalled")
  assert.match(gateway, /event\.acknowledged/)
  assert.match(gateway, /\.eq\("tenant_id", socket\.tenantId\)/, "acks are tenant-scoped")
})

test("the gateway authenticates before it delivers anything", () => {
  const gateway = read("services/realtime-gateway/server.mjs")
  assert.match(gateway, /Authenticate the session first/)
  assert.match(gateway, /Authentication timeout/, "an unauthenticated socket is closed")
  assert.match(gateway, /verifyToken\(message\.token\)/)
  assert.match(gateway, /socket\.tenantId = claims\.tenantId/)
  assert.match(gateway, /maxPayload/, "frames are bounded")
})

test("the gateway broker hop is authenticated and bounded", () => {
  const gateway = read("services/realtime-gateway/server.mjs")
  assert.match(gateway, /verifyBrokerSignature/)
  assert.match(gateway, /timingSafeEqual/)
  assert.match(gateway, /MAX_BROKER_BODY_BYTES/)
  assert.match(gateway, /body_too_large/)
  assert.match(gateway, /REALTIME_GATEWAY_INTERNAL_SECRET/)
  assert.match(gateway, /length < 32/, "a weak broker secret refuses to start")
})

test("no outbound customer-controlled URL remains, so the SSRF surface is gone", () => {
  for (const path of ["src/lib/v1/phone.ts", "src/lib/v1/agentphone.ts", "src/app/api/v1/webhooks/agentphone/route.ts"]) {
    const source = read(path)
    assert.doesNotMatch(source, /agent_webhook_url/, `${path} must not read a customer URL`)
  }
  // The only outbound hosts are configured: the provider API and our own gateway.
  assert.match(read("src/lib/v1/agentphone.ts"), /AGENTPHONE_BASE_URL/)
  assert.match(read("src/lib/v1/voice.ts"), /REALTIME_GATEWAY_INTERNAL_URL/)
  assert.match(read("src/lib/v1/voice.ts"), /must not embed credentials/)
  assert.match(read("src/lib/v1/voice.ts"), /redirect: "error"/, "redirects cannot be used to pivot")
})

test("secrets are never logged or returned", () => {
  for (const path of [
    "src/lib/v1/auth.ts",
    "src/lib/v1/secrets.ts",
    "src/lib/v1/voice.ts",
    "src/lib/v1/events.ts",
    "services/realtime-gateway/server.mjs",
  ]) {
    const source = read(path)
    for (const line of source.split("\n")) {
      if (!/console\.(log|error|warn|info)/.test(line)) continue
      assert.doesNotMatch(line, /token|secret|password|key/i, `${path} logs a credential: ${line.trim()}`)
    }
  }
  // Tokens are stored hashed, never in plaintext.
  const auth = read("src/lib/v1/auth.ts")
  assert.match(auth, /token_hash: tokenHash\(token\)/)
  assert.doesNotMatch(auth, /token_plaintext|raw_token/)
})

test("access tokens are compared in constant time and honour revocation", () => {
  const auth = read("src/lib/v1/auth.ts")
  assert.match(auth, /timingSafeEqual/)
  assert.match(auth, /revoked_at/)
  assert.match(auth, /expires_at/)
})

test("the dashboard session is signed, HttpOnly and wallet-bound", () => {
  const dashboard = read("src/lib/dashboard-auth.ts")
  assert.match(dashboard, /httpOnly: true/)
  assert.match(dashboard, /sameSite: "lax"/)
  assert.match(dashboard, /timingSafeEqual/)
  assert.match(dashboard, /nonce_hash/, "sign-in nonces are stored hashed")
  assert.match(dashboard, /consumed_at/, "a nonce is single use")
  assert.match(dashboard, /recoverMessageAddress/)
  // The signed origin must not come from an attacker-controlled Host header.
  assert.match(dashboard, /export function dashboardOrigin/)
  assert.match(dashboard, /appUrl\(\)/)
})

test("the dashboard payment path enforces wallet ownership", () => {
  const route = read("src/lib/dashboard-route.ts")
  assert.match(route, /payment\.payer\.toLowerCase\(\) !== session\.walletAddress/)
  assert.match(route, /tenant\.walletAddress !== session\.walletAddress/)
  assert.match(route, /PAYMENT_REPLAY_CONFLICT/)
})

test("private and internal surfaces are not public marketplace routes", () => {
  const proxy = read("src/proxy.ts")
  assert.match(proxy, /isPrivateAdmin/)
  assert.match(proxy, /\/admin/)
  assert.match(proxy, /API_VERSION_RETIRED/, "retired legacy routes stay closed")
  // The legacy surface is deleted, and the proxy still answers 410 rather than a
  // bare 404 so an old client gets a meaningful response.
  assert.match(proxy, /api\/asp/)
  assert.match(proxy, /410/)
})

test("the legacy API surface is deleted, not merely fail-closed", () => {
  const legacy = [
    "src/app/api/asp",
    "src/app/api/webhooks",
    "src/app/api/agents",
    "src/app/api/analytics",
    "src/app/api/api-keys",
    "src/app/api/emails",
    "src/app/api/templates",
  ]
  for (const path of legacy) {
    assert.equal(existsSync(join(root, path)), false, `${path} must no longer exist`)
  }
  // Libraries that existed only to serve those routes are gone too.
  for (const path of [
    "src/lib/asp-route.ts",
    "src/lib/asp-hints.ts",
    "src/lib/asp-manifest.ts",
    "src/lib/auth.ts",
    "src/lib/email-service.ts",
    "src/lib/phone-service.ts",
    "src/lib/domain-service.ts",
    "src/lib/providers/domain.ts",
    "src/lib/providers/phone.ts",
    "src/lib/x402.ts",
  ]) {
    assert.equal(existsSync(join(root, path)), false, `${path} is orphaned and must be removed`)
  }
  // Only v1 and the private dashboard remain under /api.
  const apiDirs = readdirSync(join(root, "src/app/api")).sort()
  assert.deepEqual(apiDirs, ["dashboard", "v1"])
})

test("no dead legacy Supabase client shim remains", () => {
  const supabase = read("src/lib/supabase.ts")
  assert.doesNotMatch(supabase, /new Proxy/, "the legacy client proxy had no consumers")
  assert.match(supabase, /requireServerSupabase/)
})

test("the internet-reachable broker endpoint is rate limited as well as signed", () => {
  const gateway = read("services/realtime-gateway/server.mjs")
  assert.match(gateway, /BROKER_RATE_LIMIT/)
  assert.match(gateway, /429/)
  // The limit is applied before the HMAC so signature checking cannot be used
  // as a CPU amplification vector.
  const handler = gateway.slice(gateway.indexOf("async function handleVoiceTurn"))
  assert.ok(
    handler.indexOf("brokerRateLimited()") < handler.indexOf("verifyBrokerSignature"),
    "rate limiting must run before signature verification",
  )
})

test("request bodies are parsed defensively", () => {
  const http = read("src/lib/v1/http.ts")
  assert.match(http, /Request body must be a JSON object/)
  assert.match(http, /Array\.isArray\(value\)/, "a JSON array is not a valid body")
  assert.match(http, /max = 10_000/, "string inputs are length-bounded")
})

test("request bodies are size-bounded independently of the hosting platform", async () => {
  const { readJson, readBoundedText, MAX_REQUEST_BODY_BYTES } = await import("../src/lib/v1/http.ts")

  const ok = await readJson(new Request("https://example.com", {
    method: "POST",
    body: JSON.stringify({ hello: "world" }),
  }))
  assert.deepEqual(ok, { hello: "world" })

  // A lying Content-Length must not get past the check.
  const oversized = "x".repeat(MAX_REQUEST_BODY_BYTES + 10)
  await assert.rejects(
    () => readBoundedText(new Request("https://example.com", { method: "POST", body: oversized })),
    /too large/,
  )
  await assert.rejects(
    () => readBoundedText(new Request("https://example.com", {
      method: "POST",
      body: "{}",
      headers: { "content-length": String(MAX_REQUEST_BODY_BYTES + 1) },
    })),
    /too large/,
  )
})

test("provider webhook bodies are bounded before the signature is computed", () => {
  for (const path of [
    "src/app/api/v1/webhooks/agentphone/route.ts",
    "src/app/api/v1/webhooks/resend/route.ts",
  ]) {
    const route = read(path)
    assert.match(route, /readBoundedText\(request\)/, `${path} must bound the raw body`)
    assert.doesNotMatch(route, /await request\.text\(\)/, `${path} must not read an unbounded body`)
  }
})

test("replay always terminates, even if the durable inbox is unreadable", () => {
  const gateway = read("services/realtime-gateway/server.mjs")
  assert.match(gateway, /REPLAY_TIMEOUT_MS/, "the replay claim is time-bounded")
  assert.match(gateway, /REPLAY_UNAVAILABLE/, "a failed replay is reported, not swallowed")
  assert.match(
    gateway,
    /send\(socket, \{ type: "session\.replay\.complete", replay \}\)/,
    "session.replay.complete is sent on both the success and failure paths",
  )
  // Events are not lost when replay defers.
  assert.match(gateway, /durable inbox/i)
})

test("a browser is never shown a credential dialog it did not ask for", async () => {
  const { proxy } = await import("../src/proxy.ts")
  const { NextRequest } = await import("next/server")
  const url = "https://api.example.com/admin"
  const call = (headers: Record<string, string>) =>
    proxy(new NextRequest(url, { headers }))

  // Chrome prerenders URLs from history when a domain is typed. That background
  // request must not carry WWW-Authenticate, or the dialog pops over whatever
  // page actually loaded.
  const prerender = call({
    "sec-purpose": "prefetch;prerender",
    "sec-fetch-mode": "navigate",
    "sec-fetch-dest": "document",
  })
  assert.equal(prerender.status, 404)
  assert.equal(prerender.headers.get("www-authenticate"), null)

  // Real speculative traffic as browsers actually send it. A prefetch is a
  // fetch, not a document navigation, so it carries cors/empty.
  const speculativeShapes: Array<Record<string, string>> = [
    { purpose: "prefetch" },
    { "x-moz": "prefetch" },
    { rsc: "1", "next-router-prefetch": "1" },
  ]
  for (const speculative of speculativeShapes) {
    const response = call({ ...speculative, "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" })
    assert.equal(response.status, 404, JSON.stringify(speculative))
    assert.equal(response.headers.get("www-authenticate"), null, JSON.stringify(speculative))
  }

  // Subresource fetches (scripts, XHR) must not prompt either.
  const subresource = call({ "sec-fetch-mode": "no-cors", "sec-fetch-dest": "image" })
  assert.equal(subresource.status, 404)
  assert.equal(subresource.headers.get("www-authenticate"), null)

  // A deliberate top-level navigation still gets the operator login prompt.
  const navigation = call({ "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" })
  assert.equal(navigation.status, 401)
  assert.match(navigation.headers.get("www-authenticate") ?? "", /^Basic realm=/)

  // Non-browser operator tooling sends no Sec-Fetch-* and must still work.
  const curl = call({})
  assert.equal(curl.status, 401)
  assert.match(curl.headers.get("www-authenticate") ?? "", /^Basic realm=/)
})
