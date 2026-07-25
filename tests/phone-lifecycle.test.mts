import assert from "node:assert/strict"
import test from "node:test"
import {
  entitlementWindow,
  reminderTimes,
  renewedWindow,
} from "../src/lib/v1/phone-lifecycle.ts"
import { PHONE_SERVICES } from "../src/lib/v1/service-catalog.ts"

test("a number purchase creates an exact 30-day UTC entitlement", () => {
  const window = entitlementWindow("2026-07-24T10:15:30.000Z")
  assert.deepEqual(window, {
    startsAt: "2026-07-24T10:15:30.000Z",
    expiresAt: "2026-08-23T10:15:30.000Z",
    renewalDeadline: "2026-08-23T10:15:30.000Z",
  })
})

test("renewal starts at the current expiry and adds one 30-day cycle", () => {
  assert.deepEqual(renewedWindow("2026-08-23T10:15:30.000Z"), {
    startsAt: "2026-08-23T10:15:30.000Z",
    expiresAt: "2026-09-22T10:15:30.000Z",
    renewalDeadline: "2026-09-22T10:15:30.000Z",
  })
})

test("reminders are scheduled 5, 3, and 1 day before expiry", () => {
  assert.deepEqual(reminderTimes("2026-08-23T10:15:30.000Z"), [
    { days: 5, runAt: "2026-08-18T10:15:30.000Z" },
    { days: 3, runAt: "2026-08-20T10:15:30.000Z" },
    { days: 1, runAt: "2026-08-22T10:15:30.000Z" },
  ])
})

test("public phone prices are fixed at the approved catalog values", () => {
  assert.equal(PHONE_SERVICES.purchaseUsNumber30Days.amount, "7.00")
  assert.equal(PHONE_SERVICES.purchaseCanadaNumber30Days.amount, "7.00")
  assert.equal(PHONE_SERVICES.renewNumber30Days.amount, "5.00")
  assert.equal(PHONE_SERVICES.outboundCall1Minute.amount, "0.30")
  assert.equal(PHONE_SERVICES.outboundCall5Minutes.amount, "1.50")
  assert.equal(PHONE_SERVICES.extendCall1Minute.amount, "0.30")
  assert.equal(PHONE_SERVICES.addInboundMinutes10.amount, "3.00")
})
