import assert from "node:assert/strict"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import test from "node:test"
import {
  DOMAIN_REGISTER_UNAVAILABLE,
  PHONE_SERVICES,
  SERVICE_CATALOG,
} from "../src/lib/v1/service-catalog.ts"

const root = process.cwd()
const read = (path: string) => readFileSync(join(root, path), "utf8")

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(join(root, dir))) {
    const rel = `${dir}/${entry}`
    if (statSync(join(root, rel)).isDirectory()) out.push(...walk(rel))
    else out.push(rel)
  }
  return out
}

const v1Routes = walk("src/app/api/v1").filter((path) => path.endsWith("route.ts"))

// Provider webhooks and the CRON-protected worker are infrastructure, not
// customer-facing marketplace operations.
const INFRASTRUCTURE = /\/(webhooks|internal)\//

test("phone prices are exactly the approved 5 / 5 / 5 values", () => {
  assert.equal(PHONE_SERVICES.purchaseUsNumber30Days.amount, "5.00")
  assert.equal(PHONE_SERVICES.purchaseCanadaNumber30Days.amount, "5.00")
  assert.equal(PHONE_SERVICES.renewNumber30Days.amount, "5.00")
  assert.equal(PHONE_SERVICES.purchaseUsNumber30Days.x402Price, "$5.00")
  assert.equal(PHONE_SERVICES.purchaseCanadaNumber30Days.x402Price, "$5.00")
  assert.equal(PHONE_SERVICES.renewNumber30Days.x402Price, "$5.00")
})

test("no customer-facing surface advertises a 7.00 phone price", () => {
  const surfaces = [
    "docs.md",
    "README.md",
    "src/lib/v1/docs.ts",
    "src/lib/v1/service-catalog.ts",
    "src/app/page.tsx",
    "src/app/openapi.json/route.ts",
    ...walk("src/app/dashboard").filter((path) => path.endsWith(".tsx")),
  ]
  for (const surface of surfaces) {
    assert.doesNotMatch(read(surface), /\b7\.00\b/, `${surface} must not quote a 7.00 phone price`)
  }
})

test("route handlers never hardcode a price literal", () => {
  for (const route of v1Routes) {
    const source = read(route)
    assert.doesNotMatch(
      source,
      /"\$?\d+\.\d{2}"/,
      `${route} must read its price from the canonical catalog, not a literal`,
    )
  }
})

test("every customer-facing non-GET route answers GET with a usage guide", () => {
  const missing: string[] = []
  for (const route of v1Routes) {
    if (INFRASTRUCTURE.test(route)) continue
    const source = read(route)
    const hasWrite = /export async function (POST|PUT|PATCH|DELETE)\b/.test(source)
    if (!hasWrite) continue
    const hasGet = /export async function GET\b/.test(source)
    if (!hasGet) missing.push(route)
  }
  assert.deepEqual(missing, [], "these non-GET routes still return 405 for GET")
})

test("GET guides are read-only: no payment, provider, or database access", () => {
  const forbidden = [
    /v1Paid\s*\(/,
    /prepareV1Payment|settleV1Payment/,
    /requireServerSupabase/,
    /agentPhoneRequest|createAgentPhone|resend/i,
  ]
  const guide = read("src/lib/v1/guide-data.ts")
  for (const pattern of forbidden) {
    assert.doesNotMatch(guide, pattern, `guide generation must not use ${pattern}`)
  }
  assert.match(guide, /executed: false/)
})

test("each generated guide carries the full documented contract", async () => {
  const { buildOperationGuide } = await import("../src/lib/v1/guide-data.ts")
  for (const service of SERVICE_CATALOG) {
    const guide = buildOperationGuide(service)
    assert.equal(guide.serviceId, service.id)
    assert.equal(guide.method, service.method)
    assert.equal(guide.endpoint, service.endpoint)
    assert.equal(guide.executed, false, `${service.id} guide must not claim execution`)
    assert.equal(guide.availability.available, service.available)
    assert.equal(guide.startHere, service.startHere)
    assert.equal(guide.price.amount, service.amount)
    assert.equal(guide.price.x402Price, service.x402Price)
    assert.ok(guide.description, `${service.id} needs a description`)
    assert.ok(guide.output, `${service.id} needs an output summary`)
    assert.ok(guide.exampleRequest.body !== undefined, `${service.id} needs an example request`)
    assert.ok(guide.documentation.docs && guide.documentation.openapi)
    assert.ok(guide.idempotency.requirement)
    assert.equal(typeof guide.authentication.required, "boolean")
    // x402 instructions only where a payment genuinely applies.
    assert.equal(guide.payment.required, service.paid && service.available)
  }
})

test("domain registration is unavailable, unpaid and never a bootstrap entry", () => {
  assert.equal(DOMAIN_REGISTER_UNAVAILABLE.available, false)
  assert.equal(DOMAIN_REGISTER_UNAVAILABLE.registerOnOkx, false)
  assert.equal(DOMAIN_REGISTER_UNAVAILABLE.paid, false)
  assert.equal(DOMAIN_REGISTER_UNAVAILABLE.x402Price, null)
  assert.equal(DOMAIN_REGISTER_UNAVAILABLE.startHere, false)
})

test("the domain route fails closed with 503 and issues no x402 challenge", () => {
  const route = read("src/app/api/v1/domains/register/route.ts")
  assert.match(route, /status:\s*503/)
  assert.doesNotMatch(route, /v1Paid|prepareV1Payment|PAYMENT-REQUIRED/, "domain must never reach the payment layer")
  assert.doesNotMatch(route, /namecheap/i, "domain must not contact a registrar")
  assert.match(route, /settled:\s*false/)
})

test("no customer-facing surface still asks for agentWebhookUrl", () => {
  const surfaces = [
    "docs.md",
    "README.md",
    "src/lib/v1/docs.ts",
    "src/lib/v1/service-catalog.ts",
    "src/app/openapi.json/route.ts",
    ...v1Routes,
    ...walk("src/components/dashboard").filter((path) => path.endsWith(".tsx")),
    ...walk("src/app/dashboard").filter((path) => path.endsWith(".tsx")),
  ]
  // Documenting that the field is gone is fine. Asking for it is not: no surface
  // may declare it as a request field, object key, catalog input or form value.
  const asksForIt = [
    /"agentWebhookUrl"\s*:/,
    /\bagentWebhookUrl\s*:\s*(?!["']?\s*$)/,
    /agentWebhookUrl=/,
  ]
  for (const surface of surfaces) {
    const source = read(surface)
    if (!source.includes("agentWebhookUrl")) continue
    const normalized = relative(".", surface).replaceAll("\\", "/")
    for (const pattern of asksForIt) {
      const offending = source.split("\n").filter((line) => pattern.test(line))
      // route.ts names the field only to reject it with a 400.
      const real = offending.filter((line) => !/no longer accepted|There is no/.test(line))
      assert.deepEqual(real, [], `${normalized} still asks for agentWebhookUrl`)
    }
  }
})

test("the retired customer callback contract is gone from the codebase", () => {
  for (const path of ["src/lib/v1/agentphone.ts", "src/lib/v1/phone.ts"]) {
    const source = read(path)
    assert.doesNotMatch(source, /callAgentWebhook|safeVoiceWebhookResponse|newAgentCallbackSecret/, path)
    assert.doesNotMatch(source, /callbackVerificationSecret/, path)
  }
  // Removing the outbound customer callback removed the SSRF surface with it.
  assert.doesNotMatch(read("src/lib/v1/agentphone.ts"), /requireSafeAgentWebhookUrl|dns\/promises/)
})

test("the AgentPhone webhook brokers live voice and never calls a customer URL", () => {
  const route = read("src/app/api/v1/webhooks/agentphone/route.ts")
  assert.match(route, /requestVoiceTurn/)
  assert.match(route, /voiceFallback/)
  assert.doesNotMatch(route, /callAgentWebhook/)
  assert.match(route, /verifyAgentPhoneWebhook/, "provider webhooks stay signature-verified")
  // A synchronous voice turn must not be answered with a durable notification.
  const voiceBlock = route.slice(route.indexOf("agent.message"))
  assert.doesNotMatch(voiceBlock.slice(0, 1200), /createDurableEvent/)
})

test("phone.call.ended still uses the durable event inbox", () => {
  const route = read("src/app/api/v1/webhooks/agentphone/route.ts")
  assert.match(route, /type: "phone\.call\.ended"/)
  assert.match(route, /createDurableEvent/)
})

test("recordings are never stored or exposed", () => {
  assert.match(read("src/lib/v1/agentphone.ts"), /stripProviderMediaFields/)
  for (const route of v1Routes) {
    assert.doesNotMatch(read(route), /recordingUrl|recording_url/, route)
  }
})

test("bootstrap token issuance is claimed once and replays do not mint tokens", () => {
  const auth = read("src/lib/v1/auth.ts")
  assert.match(auth, /claimBootstrapTokenIssuance/)
  assert.match(auth, /bootstrap_token_issued_at/)
  assert.match(auth, /\.is\("bootstrap_token_issued_at", null\)/, "issuance must be a conditional claim")
  assert.match(auth, /accessToken: null/, "the already-issued notice returns no token")

  const route = read("src/lib/v1/route.ts")
  const replay = route.slice(route.indexOf('state.kind === "replay"'), route.indexOf('state.kind === "in_progress"'))
  assert.doesNotMatch(replay, /issueAccessToken/, "a replay must not issue a new access token")
  assert.match(route, /bootstrap && await claimBootstrapTokenIssuance/)
})

test("the bootstrap claim is enforced by the database, not only in application code", () => {
  const migration = read("supabase/migrations/20260727130000_bootstrap_token_once.sql")
  assert.match(migration, /add column if not exists bootstrap_token_issued_at/)
  assert.match(migration, /update public\.v1_users/, "existing token holders are backfilled")
})

test("canonical public URLs come from configuration, not a hardcoded domain", () => {
  for (const path of [...v1Routes, "src/app/openapi.json/route.ts", "src/lib/v1/config.ts", "src/lib/v1/guide-data.ts"]) {
    assert.doesNotMatch(read(path), /hostbyme|zerolayer/i, `${path} must not hardcode a deployment domain`)
  }
  assert.match(read("src/app/openapi.json/route.ts"), /process\.env\.APP_URL/)
  assert.match(read("services/durable-worker/worker.mjs"), /AGENTOS_APP_URL/)
  assert.match(read("src/lib/v1/events.ts"), /REALTIME_GATEWAY_URL/)
})

test("provider identifiers are never returned to customers", () => {
  const phone = read("src/lib/v1/phone.ts")
  const publicShape = phone.slice(phone.indexOf("function publicNumber"), phone.indexOf("async function ownedNumber"))
  assert.doesNotMatch(publicShape, /provider_number_id|provider_agent_id|provider_sub_account_id/)
})
