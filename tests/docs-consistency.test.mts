import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"
import { agentDocs, llmsText } from "../src/lib/v1/docs.ts"
import { PHONE_SERVICES, SERVICE_CATALOG } from "../src/lib/v1/service-catalog.ts"

const root = process.cwd()
const read = (path: string) => readFileSync(join(root, path), "utf8")

// Every customer-facing description of the system must agree. These are the
// surfaces an agent actually reads.
const markdownSurfaces = { "docs.md": read("docs.md"), "README.md": read("README.md") }
const generatedSurfaces = { "/docs": agentDocs, "/llms.txt": llmsText }
const allSurfaces = { ...markdownSurfaces, ...generatedSurfaces }

test("/docs and /llms.txt are served from the same source as the repo docs", () => {
  assert.match(read("src/app/docs/route.ts"), /agentDocs/)
  assert.match(read("src/app/llms.txt/route.ts"), /llmsText/)
})

test("/docs.md is an alias that serves the canonical /docs markdown", () => {
  const alias = read("src/app/docs.md/route.ts")
  assert.match(alias, /agentDocs/, "the alias serves identical content")
  assert.match(alias, /text\/markdown/)
  assert.match(alias, /rel="canonical"/, "it points back at /docs as canonical")
  // /docs must still exist and remain valid without the extension.
  assert.match(read("src/app/docs/route.ts"), /text\/markdown/)
})

test("every discovery surface is reachable", () => {
  for (const route of [
    "src/app/api/v1/route.ts",
    "src/app/api/v1/services/route.ts",
    "src/app/openapi.json/route.ts",
    "src/app/docs/route.ts",
    "src/app/llms.txt/route.ts",
  ]) {
    assert.match(read(route), /export async function GET/, `${route} must serve GET`)
  }
})

test("all docs quote 5.00 USDT for phone numbers and never 7.00", () => {
  for (const [name, source] of Object.entries(allSurfaces)) {
    assert.doesNotMatch(source, /\b7\.00\b/, `${name} quotes a retired 7.00 price`)
  }
  for (const [name, source] of Object.entries(generatedSurfaces)) {
    assert.match(source, /5\.00 USDT/, `${name} must state the 5.00 USDT number price`)
  }
  assert.equal(PHONE_SERVICES.purchaseUsNumber30Days.amount, "5.00")
})

test("all docs describe phone as WebSocket, not a customer webhook", () => {
  for (const [name, source] of Object.entries(allSurfaces)) {
    assert.match(source, /voice\.turn/, `${name} must document the live-voice turn`)
    assert.match(source, /voice\.response/, `${name} must document the voice response`)
    assert.doesNotMatch(
      source,
      /X-AgentOS-Signature|callbackVerificationSecret/,
      `${name} still documents the retired customer callback`,
    )
  }
})

test("docs distinguish durable notifications from synchronous live voice", () => {
  for (const [name, source] of Object.entries(generatedSurfaces)) {
    assert.match(source, /event\.delivery/, `${name} must document durable delivery`)
    assert.match(source, /event\.ack/, `${name} must document acknowledgement`)
    assert.match(source, /voice\.turn/, `${name} must document live voice`)
  }
  // The distinction has to be stated, not merely implied by both appearing.
  assert.match(agentDocs, /never (?:stored|persisted)|never replayed/i)
  assert.match(agentDocs, /Live voice protocol/)
})

test("docs state that Domain is unavailable and requests no payment", () => {
  for (const [name, source] of Object.entries(allSurfaces)) {
    assert.match(source, /[Dd]omain/, `${name} should mention Domain`)
  }
  assert.match(agentDocs, /503/)
  assert.match(agentDocs, /Cloudflare/, "planned Cloudflare support may be mentioned")
  assert.match(agentDocs, /not implemented/)
})

test("customer docs no longer imply Domain is close to production via Namecheap", () => {
  for (const [name, source] of Object.entries(generatedSurfaces)) {
    const namecheap = source.split("\n").filter((line) => /namecheap/i.test(line))
    for (const line of namecheap) {
      assert.match(
        line,
        /unused|legacy|unreachable|not a step/i,
        `${name} still frames Namecheap as an activation path: ${line}`,
      )
    }
  }
})

test("docs state the token bootstrap and x402 per-operation rules", () => {
  assert.match(agentDocs, /x402/i)
  assert.match(agentDocs, /shown only once|only once/i)
  assert.match(agentDocs, /Reuse the same token across Email, Phone/)
  assert.match(llmsText, /x402/i)
})

test("docs state that recordings are disabled and never exposed", () => {
  for (const [name, source] of Object.entries(generatedSurfaces)) {
    assert.match(source, /[Rr]ecording/, `${name} must address recordings`)
  }
  assert.match(agentDocs, /Recording is out of scope/)
  assert.match(agentDocs, /transcripts remain available|Only transcripts/i)
})

test("docs describe the deployment topology honestly", () => {
  assert.match(agentDocs, /Vercel/)
  assert.match(agentDocs, /gateway/i)
  assert.match(agentDocs, /worker/i)
  assert.match(agentDocs, /REALTIME_GATEWAY_INTERNAL/, "the broker hop must be documented for operators")
})

test("documented event types are the ones the code actually emits", () => {
  const emitted = new Set<string>()
  for (const path of [
    "src/app/api/v1/webhooks/agentphone/route.ts",
    "src/app/api/v1/webhooks/resend/route.ts",
    "src/lib/v1/phone.ts",
    "src/lib/v1/jobs.ts",
  ]) {
    for (const match of read(path).matchAll(/type:\s*"([a-z]+\.[a-z.]+)"/g)) emitted.add(match[1])
  }
  assert.ok(emitted.size > 0, "expected to find emitted event types")
  for (const type of emitted) {
    assert.ok(
      agentDocs.includes(type),
      `/docs does not document the ${type} event that the code emits`,
    )
  }
})

test("every available catalog service appears in the docs", () => {
  for (const service of SERVICE_CATALOG) {
    if (!service.available) continue
    assert.ok(
      agentDocs.includes(service.endpoint) || agentDocs.includes(service.id),
      `/docs does not mention ${service.id}`,
    )
  }
})

test("the OpenAPI server URL and prices come from canonical configuration", () => {
  const openapi = read("src/app/openapi.json/route.ts")
  assert.match(openapi, /servers:\s*\[\{\s*url:\s*process\.env\.APP_URL/)
  assert.match(openapi, /PHONE_SERVICES\.purchaseUsNumber30Days\.amount/)
  assert.doesNotMatch(openapi, /"[57]\.00"/, "OpenAPI must not restate phone prices as literals")
})
