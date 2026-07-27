import assert from "node:assert/strict"
import test from "node:test"
import {
  VOICE_MAX_TEXT_LENGTH,
  VOICE_MAX_TURN_MS,
  VOICE_MIN_TURN_MS,
  VoiceTurnRegistry,
  clampTurnDeadline,
  normalizeVoiceResponse,
} from "../services/realtime-gateway/voice-turns.mjs"
import {
  signVoiceBrokerRequest,
  verifyVoiceBrokerSignature,
  voiceFallback,
} from "../src/lib/v1/voice.ts"

// Deterministic: no provider, no network, no database. Timers are injected so
// deadline behaviour is exercised without real waiting.
function harness() {
  const sent: Array<{ socket: unknown; message: Record<string, unknown> }> = []
  const timers = new Map<number, () => void>()
  let nextTimer = 1
  const registry = new VoiceTurnRegistry({
    setTimer: (fn: () => void) => {
      const id = nextTimer++
      timers.set(id, fn)
      return id
    },
    clearTimer: (id: number) => timers.delete(id),
  })
  const send = (socket: unknown, message: Record<string, unknown>) => sent.push({ socket, message })
  const fireAll = () => {
    for (const fn of [...timers.values()]) fn()
  }
  return { registry, send, sent, fireAll, pendingTimers: () => timers.size }
}

const socketFor = (tenantId: string) => ({ tenantId })

test("a turn is delivered to the tenant socket and resolved by a matching response", async () => {
  const { registry, send, sent } = harness()
  const socket = socketFor("tenant-a")
  const pending = registry.open({
    turnId: "vt_1",
    tenantId: "tenant-a",
    socket,
    send,
    callId: "call-1",
    phoneNumberId: "number-1",
    transcript: "hello there",
  })

  const turn = sent[0].message
  assert.equal(turn.type, "voice.turn")
  assert.equal(turn.turnId, "vt_1")
  assert.equal(turn.callId, "call-1")
  assert.equal(turn.phoneNumberId, "number-1")
  assert.equal(turn.transcript, "hello there")
  assert.ok(turn.deadline, "the agent is told its response deadline")

  assert.deepEqual(
    registry.resolve(socket, { type: "voice.response", turnId: "vt_1", text: "Hi, how can I help?" }),
    { ok: true, turnId: "vt_1" },
  )
  assert.deepEqual(await pending, {
    status: "answered",
    response: { text: "Hi, how can I help?" },
  })
  assert.equal(registry.size, 0, "the turn is released once answered")
})

test("a response from another tenant cannot answer the turn", async () => {
  const { registry, send } = harness()
  const owner = socketFor("tenant-a")
  const attacker = socketFor("tenant-b")
  const pending = registry.open({ turnId: "vt_2", tenantId: "tenant-a", socket: owner, send })

  assert.deepEqual(
    registry.resolve(attacker, { type: "voice.response", turnId: "vt_2", text: "leaked" }),
    { ok: false, reason: "wrong_tenant" },
  )
  assert.equal(registry.size, 1, "the turn stays open for its real owner")

  registry.resolve(owner, { type: "voice.response", turnId: "vt_2", text: "mine" })
  assert.deepEqual(await pending, { status: "answered", response: { text: "mine" } })
})

test("the same turn cannot be answered twice", async () => {
  const { registry, send } = harness()
  const socket = socketFor("tenant-a")
  const pending = registry.open({ turnId: "vt_3", tenantId: "tenant-a", socket, send })

  assert.equal(registry.resolve(socket, { turnId: "vt_3", text: "first" }).ok, true)
  assert.deepEqual(
    registry.resolve(socket, { turnId: "vt_3", text: "second" }),
    { ok: false, reason: "unknown_turn" },
  )
  assert.deepEqual(await pending, { status: "answered", response: { text: "first" } })
})

test("an unanswered turn times out, notifies the agent, and frees its slot", async () => {
  const { registry, send, sent, fireAll, pendingTimers } = harness()
  const socket = socketFor("tenant-a")
  const pending = registry.open({ turnId: "vt_4", tenantId: "tenant-a", socket, send, deadlineMs: 5_000 })

  assert.equal(registry.size, 1)
  fireAll()

  assert.deepEqual(await pending, { status: "timeout", reason: "deadline_exceeded" })
  const timeout = sent.find((entry) => entry.message.type === "voice.timeout")
  assert.ok(timeout, "the agent is told the turn expired")
  assert.equal(timeout!.message.turnId, "vt_4")
  assert.equal(registry.size, 0, "no unresolved turn is retained")
  assert.equal(pendingTimers(), 0, "the deadline timer is cleared")
})

test("a disconnecting socket settles every turn waiting on it", async () => {
  const { registry, send } = harness()
  const socket = socketFor("tenant-a")
  const other = socketFor("tenant-b")
  const first = registry.open({ turnId: "vt_5", tenantId: "tenant-a", socket, send })
  const second = registry.open({ turnId: "vt_6", tenantId: "tenant-a", socket, send })
  const untouched = registry.open({ turnId: "vt_7", tenantId: "tenant-b", socket: other, send })

  assert.equal(registry.failSocket(socket), 2)
  assert.deepEqual(await first, { status: "disconnected", reason: "agent_socket_closed" })
  assert.deepEqual(await second, { status: "disconnected", reason: "agent_socket_closed" })
  assert.equal(registry.size, 1, "another tenant's turn is unaffected")

  registry.resolve(other, { turnId: "vt_7", hangup: true })
  assert.equal((await untouched).status, "answered")
})

test("an explicit cancel resolves the turn without an answer", async () => {
  const { registry, send } = harness()
  const socket = socketFor("tenant-a")
  const pending = registry.open({ turnId: "vt_8", tenantId: "tenant-a", socket, send })
  assert.equal(registry.cancel(socket, { turnId: "vt_8" }).ok, true)
  assert.deepEqual(await pending, { status: "canceled", reason: "agent_canceled" })
})

test("pending turns are bounded so a stalled agent cannot exhaust memory", async () => {
  const { send } = harness()
  const registry = new VoiceTurnRegistry({ maxPending: 2, setTimer: () => 1, clearTimer: () => {} })
  const socket = socketFor("tenant-a")
  registry.open({ turnId: "a", tenantId: "tenant-a", socket, send })
  registry.open({ turnId: "b", tenantId: "tenant-a", socket, send })
  assert.deepEqual(
    await registry.open({ turnId: "c", tenantId: "tenant-a", socket, send }),
    { status: "overloaded", reason: "too_many_pending_turns" },
  )
})

test("invalid agent replies are rejected rather than forwarded to the caller", () => {
  assert.equal(normalizeVoiceResponse(null), null)
  assert.equal(normalizeVoiceResponse({}), null, "no text and no hangup is not an action")
  assert.equal(normalizeVoiceResponse({ text: "   " }), null, "blank text is not an action")
  assert.equal(normalizeVoiceResponse({ text: 42 }), null)
  assert.equal(normalizeVoiceResponse({ text: "x".repeat(VOICE_MAX_TEXT_LENGTH + 1) }), null)
  assert.equal(normalizeVoiceResponse({ hangup: "yes" }), null)
  assert.equal(normalizeVoiceResponse({ digits: "abc" }), null)

  assert.deepEqual(normalizeVoiceResponse({ hangup: true }), { hangup: true })
  assert.deepEqual(normalizeVoiceResponse({ action: "hangup" }), { action: "hangup" })
  assert.deepEqual(
    normalizeVoiceResponse({ text: " hello ", hangup: false, digits: "12#" }),
    { text: "hello", hangup: false, digits: "12#" },
  )
})

test("agent replies cannot smuggle extra fields to the provider", () => {
  const normalized = normalizeVoiceResponse({
    text: "hi",
    recordingUrl: "https://example.com/audio.mp3",
    audio_url: "https://example.com/audio.mp3",
    transferTo: "+14155550000",
  })
  assert.deepEqual(normalized, { text: "hi" })
})

test("turn deadlines are clamped to a safe range", () => {
  assert.equal(clampTurnDeadline(undefined), 8_000)
  assert.equal(clampTurnDeadline("nonsense"), 8_000)
  assert.equal(clampTurnDeadline(1), VOICE_MIN_TURN_MS)
  assert.equal(clampTurnDeadline(10 * 60_000), VOICE_MAX_TURN_MS)
  assert.equal(clampTurnDeadline(5_000), 5_000)
})

test("every non-answered turn status maps to a safe spoken fallback", () => {
  for (const status of ["timeout", "canceled", "no_socket", "disconnected", "overloaded", "invalid", "unavailable"] as const) {
    const fallback = voiceFallback(status)
    assert.equal(typeof fallback.text, "string")
    assert.ok(fallback.text!.length > 0, `${status} says something to the caller`)
    assert.equal(typeof fallback.hangup, "boolean")
  }
  // An unreachable agent ends the call; a single slow turn keeps it alive.
  assert.equal(voiceFallback("no_socket").hangup, true)
  assert.equal(voiceFallback("disconnected").hangup, true)
  assert.equal(voiceFallback("timeout").hangup, false)
})

test("the broker hop is authenticated with a timing-safe, time-bound HMAC", () => {
  const secret = "s".repeat(48)
  const body = JSON.stringify({ turnId: "vt_9", tenantId: "tenant-a" })
  const timestamp = "1800000000"
  const signature = signVoiceBrokerRequest(body, timestamp, secret)
  const nowSeconds = Number(timestamp)

  assert.equal(verifyVoiceBrokerSignature({ body, timestamp, signature, secret, nowSeconds }), true)
  assert.equal(
    verifyVoiceBrokerSignature({ body: body + " ", timestamp, signature, secret, nowSeconds }),
    false,
    "a tampered body fails",
  )
  assert.equal(
    verifyVoiceBrokerSignature({ body, timestamp, signature, secret: "x".repeat(48), nowSeconds }),
    false,
    "a wrong secret fails",
  )
  assert.equal(
    verifyVoiceBrokerSignature({ body, timestamp, signature, secret, nowSeconds: nowSeconds + 3_600 }),
    false,
    "a stale request is replayed in vain",
  )
})
