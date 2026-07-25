import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const root = process.cwd()

function source(path: string) {
  return readFileSync(join(root, path), "utf8")
}

test("dashboard navigation points only to implemented owner pages", () => {
  const nav = source("src/components/app-shell/nav-items.tsx")
  for (const route of [
    "/dashboard",
    "/dashboard/mailboxes",
    "/dashboard/numbers",
    "/dashboard/domains",
    "/dashboard/events",
    "/dashboard/api-keys",
    "/dashboard/guide",
    "/dashboard/settings",
  ]) {
    assert.match(nav, new RegExp(route.replaceAll("/", "\\/")))
  }
})

test("dashboard UI does not call retired or legacy application APIs", () => {
  const files = [
    "src/app/dashboard/page.tsx",
    "src/components/dashboard/mailbox-manager.tsx",
    "src/components/dashboard/phone-manager.tsx",
    "src/components/dashboard/event-manager.tsx",
    "src/components/dashboard/token-manager.tsx",
  ]
  const retired = /\/api\/(?:asp|analytics|templates|api-keys|agents)(?:\/|["'`])/
  for (const file of files) assert.doesNotMatch(source(file), retired, file)
})

test("dashboard paid bridge enforces every UI-exposed service by canonical ID", () => {
  const route = source("src/app/api/dashboard/service/route.ts")
  for (const service of [
    "createMailbox",
    "sendMessage",
    "purchaseUsNumber30Days",
    "purchaseCanadaNumber30Days",
    "renewNumber30Days",
    "outboundCall1Minute",
    "outboundCall5Minutes",
    "extendCall1Minute",
    "addInboundMinutes10",
  ]) {
    assert.match(route, new RegExp(`(?:EMAIL|PHONE)_SERVICES\\.${service}\\.id`))
  }
})

test("documentation separates wallet dashboard, agent tokens, and private admin", () => {
  const docs = source("docs.md")
  assert.match(docs, /wallet-signature owner portal/)
  assert.match(docs, /operator-only Basic-auth administration/)
  assert.doesNotMatch(docs, /dashboard\/\*\*: owner-only Basic-auth/)
})
