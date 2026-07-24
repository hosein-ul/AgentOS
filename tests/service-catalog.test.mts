import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"
import {
  EMAIL_SERVICES,
  SERVICE_CATALOG,
  isStartHereEndpoint,
} from "../src/lib/v1/service-catalog.ts"

test("service IDs and method/path pairs are unique", () => {
  assert.equal(new Set(SERVICE_CATALOG.map((service) => service.id)).size, SERVICE_CATALOG.length)
  assert.equal(
    new Set(SERVICE_CATALOG.map((service) => `${service.method} ${service.endpoint}`)).size,
    SERVICE_CATALOG.length,
  )
})

test("every catalog service has a real Next route", () => {
  for (const service of SERVICE_CATALOG) {
    const routePath = service.endpoint
      .replace(/^\/api\//, "")
      .replace(/\{([^}]+)\}/g, "[$1]")
    assert.equal(
      existsSync(join(process.cwd(), "src", "app", "api", routePath, "route.ts")),
      true,
      `Missing route for ${service.id}`,
    )
  }
})

test("only provisioning services bootstrap without a bearer token", () => {
  const startHere = SERVICE_CATALOG.filter((service) => service.startHere && service.available)
  assert.deepEqual(
    startHere.map((service) => service.id).sort(),
    ["email.mailbox.create", "phone.number.ca.30d", "phone.number.us.30d"],
  )
  for (const service of SERVICE_CATALOG.filter((entry) => entry.paid && !entry.startHere)) {
    assert.equal(service.authenticated, true, service.id)
    assert.equal(isStartHereEndpoint(service.endpoint), false, service.id)
  }
})

test("email route prices come from the canonical catalog", () => {
  assert.equal(EMAIL_SERVICES.createMailbox.amount, "0.25")
  assert.equal(EMAIL_SERVICES.updateMailbox.amount, "0.01")
  assert.equal(EMAIL_SERVICES.deleteMailbox.amount, "0.01")
  assert.equal(EMAIL_SERVICES.sendMessage.amount, "0.02")
  const route = readFileSync(
    join(process.cwd(), "src/app/api/v1/email/mailboxes/route.ts"),
    "utf8",
  )
  assert.match(route, /EMAIL_SERVICES\.createMailbox/)
  assert.doesNotMatch(route, /"\$0\.25"/)
})

test("unavailable domain registration is never an OKX paid listing", () => {
  const domain = SERVICE_CATALOG.find((service) => service.id === "domain.register")
  assert.ok(domain)
  assert.equal(domain.available, false)
  assert.equal(domain.registerOnOkx, false)
  assert.equal(domain.paid, false)
})

test("unified event migration includes tenant-safe delivery indexes and states", () => {
  const migration = readFileSync(
    join(process.cwd(), "supabase/migrations/20260724150000_unified_durable_events.sql"),
    "utf8",
  )
  assert.match(migration, /tenant_id, status, created_at, id/)
  assert.match(migration, /agent_id, status/)
  assert.match(migration, /resource_type, resource_id/)
  assert.match(migration, /'pending', 'delivered', 'acknowledged', 'expired', 'failed'/)
  assert.match(migration, /for update skip locked/i)
})
