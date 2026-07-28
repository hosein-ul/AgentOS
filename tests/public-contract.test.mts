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
  const migration = read("supabase/migrations/20260727203347_bootstrap_token_once.sql")
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

// The six free customer capabilities that must be listable as free A2MCP
// services on OKX.AI. Being free is a billing fact, not a reason to hide them.
const FREE_REGISTERED = [
  "email.mailbox.list",
  "email.message.query",
  "phone.number.release",
  "phone.number.list",
  "phone.call.get",
  "phone.call.transcript",
] as const

test("the six free customer capabilities are OKX-registration eligible", () => {
  for (const id of FREE_REGISTERED) {
    const service = SERVICE_CATALOG.find((entry) => entry.id === id)
    assert.ok(service, `${id} is missing from the catalog`)
    assert.equal(service.available, true, `${id} available`)
    assert.equal(service.registerOnOkx, true, `${id} registerOnOkx`)
    assert.equal(service.paid, false, `${id} paid`)
    assert.equal(service.amount, "0.00", `${id} amount`)
    assert.equal(service.currency, "USDT", `${id} currency`)
    assert.equal(service.x402Price, null, `${id} x402Price`)
    assert.equal(service.authenticated, true, `${id} authenticated`)
    assert.equal(service.startHere, false, `${id} startHere`)
  }
})

test("marketplace registration is decoupled from pricing", () => {
  const registeredFree = SERVICE_CATALOG.filter((s) => s.registerOnOkx && !s.paid)
  assert.deepEqual(
    registeredFree.map((s) => s.id).sort(),
    [...FREE_REGISTERED].sort(),
    "exactly these free services are registered",
  )
  // The helper must not force registration off for free entries.
  const catalog = read("src/lib/v1/service-catalog.ts")
  assert.doesNotMatch(catalog, /\n\s*registerOnOkx: false,\n\s*requiredInput:/,
    "free() must not hardcode registerOnOkx: false")
  assert.match(catalog, /registerOnOkx: options\.registerOnOkx \?\? false/)
})

test("a registered free service never carries an x402 price", () => {
  for (const service of SERVICE_CATALOG.filter((s) => s.registerOnOkx && !s.paid)) {
    assert.equal(service.x402Price, null, `${service.id} must not advertise a price`)
    assert.equal(service.amount, "0.00", service.id)
  }
})

test("free registered routes execute normally and never reach the payment layer", () => {
  const routeFor = (endpoint: string) =>
    `src/app${endpoint.replace(/\{([^}]+)\}/g, "[$1]")}/route.ts`
  for (const id of FREE_REGISTERED) {
    const service = SERVICE_CATALOG.find((entry) => entry.id === id)!
    const source = read(routeFor(service.endpoint))
    assert.doesNotMatch(source, /v1Paid/, `${id} must not use the paid wrapper`)
    assert.doesNotMatch(source, /prepareV1Payment|settleV1Payment/, `${id} must not touch payment`)
    assert.doesNotMatch(source, /402/, `${id} must never return a payment challenge`)
    // It is still a real, authenticated operation.
    assert.match(source, /v1Read|v1Write|v1Action/, `${id} must execute normally`)
  }
})

test("discovery and event plumbing stay unregistered", () => {
  for (const id of ["discovery.api", "discovery.services", "events.list", "events.get", "events.ack", "events.ack-all", "events.realtime-token"]) {
    const service = SERVICE_CATALOG.find((entry) => entry.id === id)
    assert.ok(service, id)
    assert.equal(service.registerOnOkx, false, `${id} is infrastructure, not a marketplace listing`)
  }
})

test("the A2A execution service is never listed as a REST A2MCP operation", () => {
  // Swap & Bridge Execution is a negotiated OKX A2A job with its own runtime and
  // database. Putting it in the fixed-price catalog or OpenAPI would advertise an
  // agreed fee as a fixed x402 price.
  for (const service of SERVICE_CATALOG) {
    assert.doesNotMatch(service.id, /swap|bridge|execution/i, `${service.id} must not be an A2A listing`)
    assert.doesNotMatch(service.endpoint, /swap|bridge|execution/i, service.endpoint)
  }
  for (const path of ["src/lib/v1/service-catalog.ts", "src/app/openapi.json/route.ts"]) {
    const source = read(path)
    assert.doesNotMatch(source, /LI\.FI|Across/i, `${path} must not reference A2A route providers`)
    assert.doesNotMatch(source, /0\.09/, `${path} must not carry the A2A starting fee`)
  }
  // No catalog entry may claim a negotiated price.
  for (const service of SERVICE_CATALOG) {
    if (!service.paid) continue
    assert.match(service.amount, /^\d+\.\d{2}$/, `${service.id} must be a fixed decimal price`)
  }
})

test("the landing page presents A2A first and never mislabels non-fixed prices", () => {
  const page = read("src/app/page.tsx")
  // A2A must be defined and rendered before the A2MCP service grid.
  assert.ok(page.indexOf("const execution") < page.indexOf("const infrastructure"),
    "A2A must be the primary service")
  for (const claim of ["Swap & Bridge Execution", "OKX", "LI.FI", "Across", "80", "19,179", "51,703"]) {
    assert.ok(page.includes(claim), `landing page must state ${claim}`)
  }
  assert.match(page, /[Nn]on-custodial/)
  assert.match(page, /signs and broadcasts/)
  // The old bug: a blanket " USDT" suffix turned FREE into "FREE USDT".
  assert.doesNotMatch(page, /\{service\.price\}\s*USDT/, "prices must render verbatim, not be suffixed")
  assert.match(page, /FROM 0\.09/)
  assert.doesNotMatch(page, /FROM 0\.09 USDT|FREE USDT/, "a starting fee is not a fixed USDT price")
  // Both models must be explained.
  assert.ok(page.includes("A2MCP") && page.includes("A2A"))
})
