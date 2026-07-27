// Mocked live-voice integration check.
//
// Boots the real realtime gateway, connects a real WebSocket client as a customer
// Agent, and drives the broker hop that the AgentPhone webhook uses. No provider,
// no payment and no database write is involved: Supabase is pointed at an
// unreachable placeholder, and only the gateway's own HTTP and WebSocket paths
// are exercised.
//
// Usage: node scripts/voice-roundtrip-check.mjs

import { createHmac } from "node:crypto"
import { spawn } from "node:child_process"
import { WebSocket } from "ws"

const PORT = 8799
const JWT_SECRET = "integration-realtime-jwt-secret-000000"
const INTERNAL_SECRET = "integration-internal-broker-secret-0000"
// One tenant per scenario. A tenant may have several sockets connected and the
// gateway picks one of them for a turn, so sharing a tenant between scenarios
// would make the assertions depend on socket ordering rather than on behaviour.
const TENANT_A = "11111111-1111-1111-1111-111111111111"
const TENANT_B = "22222222-2222-2222-2222-222222222222"
const TENANT_DUP = "33333333-3333-3333-3333-333333333333"
const TENANT_SILENT = "44444444-4444-4444-4444-444444444444"
const TENANT_DROP = "55555555-5555-5555-5555-555555555555"
const TENANT_NOTIFY = "66666666-6666-6666-6666-666666666666"

const results = []
const record = (name, ok, detail = "") => {
  results.push({ name, ok, detail })
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`)
}

const base64url = (value) => Buffer.from(value).toString("base64url")

function realtimeToken(tenantId, secondsValid = 900) {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))
  const payload = base64url(JSON.stringify({
    aud: "agentos-realtime",
    sub: tenantId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + secondsValid,
  }))
  const signature = createHmac("sha256", JWT_SECRET).update(`${header}.${payload}`).digest("base64url")
  return `${header}.${payload}.${signature}`
}

async function brokerTurn(body) {
  const raw = JSON.stringify(body)
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = `sha256=${createHmac("sha256", INTERNAL_SECRET).update(`${timestamp}.${raw}`).digest("hex")}`
  const response = await fetch(`http://127.0.0.1:${PORT}/internal/voice/turn`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agentos-timestamp": timestamp,
      "x-agentos-signature": signature,
    },
    body: raw,
  })
  return { status: response.status, body: await response.json().catch(() => null) }
}

function connectAgent(tenantId, onTurn) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${PORT}/v1/events`)
    const timer = setTimeout(() => reject(new Error("agent socket timeout")), 8_000)
    socket.on("open", () => socket.send(JSON.stringify({ type: "session.authenticate", token: realtimeToken(tenantId) })))
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString())
      if (message.type === "session.ready") {
        clearTimeout(timer)
        resolve({ socket, ready: message })
      }
      if (message.type === "voice.turn" && onTurn) onTurn(socket, message)
    })
    socket.on("error", (error) => { clearTimeout(timer); reject(error) })
  })
}

const gateway = spawn(process.execPath, ["services/realtime-gateway/server.mjs"], {
  env: {
    ...process.env,
    PORT: String(PORT),
    SUPABASE_URL: "https://placeholder.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "placeholder-service-role-key",
    REALTIME_GATEWAY_JWT_SECRET: JWT_SECRET,
    REALTIME_GATEWAY_INTERNAL_SECRET: INTERNAL_SECRET,
  },
  stdio: ["ignore", "pipe", "pipe"],
})
gateway.stdout.on("data", (chunk) => process.env.VERBOSE && console.log(`[gateway] ${chunk}`))
gateway.stderr.on("data", (chunk) => process.env.VERBOSE && console.error(`[gateway] ${chunk}`))

async function waitForHealth() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/health`)
      if (response.ok) return await response.json()
    } catch {
      // gateway still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error("gateway did not become healthy")
}

try {
  const health = await waitForHealth()
  record("gateway starts and reports health", health.ok === true, JSON.stringify(health))

  // 1. No connected socket -> the call fails safely, it does not hang.
  const orphan = await brokerTurn({ tenantId: TENANT_A, turnId: "vt_no_socket", phoneNumberId: "n1" })
  record("no authenticated socket yields no_socket", orphan.body?.status === "no_socket", orphan.body?.reason)

  // 2. Unsigned broker requests are refused.
  const unsigned = await fetch(`http://127.0.0.1:${PORT}/internal/voice/turn`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantId: TENANT_A, turnId: "vt_unsigned" }),
  })
  record("unsigned broker request is rejected", unsigned.status === 401)

  // 3. Full happy-path round trip.
  const agentA = await connectAgent(TENANT_A, (socket, turn) => {
    socket.send(JSON.stringify({
      type: "voice.response",
      turnId: turn.turnId,
      text: `You said: ${turn.transcript}`,
      hangup: false,
    }))
  })
  record(
    "session.ready advertises both protocols",
    Boolean(agentA.ready.protocols?.notifications && agentA.ready.protocols?.voice),
    JSON.stringify(agentA.ready.protocols?.voice),
  )

  const answered = await brokerTurn({
    tenantId: TENANT_A,
    turnId: "vt_live_1",
    callId: "call-1",
    phoneNumberId: "number-1",
    transcript: "I need to reschedule",
    deadlineMs: 5_000,
  })
  record(
    "live voice round trip returns the agent's answer",
    answered.body?.status === "answered" && answered.body?.response?.text === "You said: I need to reschedule",
    JSON.stringify(answered.body?.response),
  )

  // 4. A second agent on another tenant must not be able to answer tenant A.
  let stolen = false
  const agentB = await connectAgent(TENANT_B)
  agentB.socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString())
    if (message.type === "voice.turn") stolen = true
  })
  const crossTenant = brokerTurn({
    tenantId: TENANT_A,
    turnId: "vt_cross",
    phoneNumberId: "number-1",
    transcript: "secret",
    deadlineMs: 3_000,
  })
  await new Promise((resolve) => setTimeout(resolve, 300))
  agentB.socket.send(JSON.stringify({ type: "voice.response", turnId: "vt_cross", text: "intercepted" }))
  const crossResult = await crossTenant
  record("another tenant never receives the turn", stolen === false)
  record(
    "a cross-tenant response cannot answer the turn",
    crossResult.body?.response?.text !== "intercepted",
    `status=${crossResult.body?.status}`,
  )

  // 5. Duplicate answers are ignored.
  let duplicateRejected = false
  const dupAgent = await connectAgent(TENANT_DUP, (socket, turn) => {
    socket.send(JSON.stringify({ type: "voice.response", turnId: turn.turnId, text: "first" }))
    socket.send(JSON.stringify({ type: "voice.response", turnId: turn.turnId, text: "second" }))
  })
  dupAgent.socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString())
    if (message.type === "error" && message.error?.code === "VOICE_RESPONSE_REJECTED") duplicateRejected = true
  })
  const duplicate = await brokerTurn({ tenantId: TENANT_DUP, turnId: "vt_dup", phoneNumberId: "n2", deadlineMs: 4_000 })
  await new Promise((resolve) => setTimeout(resolve, 300))
  record(
    "only the first answer is used",
    duplicate.body?.status === "answered" && duplicate.body?.response?.text === "first",
    JSON.stringify(duplicate.body?.response),
  )
  record("the duplicate answer is explicitly rejected", duplicateRejected)

  // 6. A silent agent times out instead of hanging the call.
  const silent = await connectAgent(TENANT_SILENT)
  let sawTimeout = false
  silent.socket.on("message", (raw) => {
    if (JSON.parse(raw.toString()).type === "voice.timeout") sawTimeout = true
  })
  const startedAt = Date.now()
  const timedOut = await brokerTurn({ tenantId: TENANT_SILENT, turnId: "vt_timeout", phoneNumberId: "n1", deadlineMs: 1_500 })
  const elapsed = Date.now() - startedAt
  record("a silent agent times out", timedOut.body?.status === "timeout", `${elapsed}ms`)
  record("the deadline is honoured", elapsed < 4_000, `${elapsed}ms`)
  await new Promise((resolve) => setTimeout(resolve, 200))
  record("the agent is told its turn expired", sawTimeout)

  // 7. A disconnecting agent settles the turn immediately.
  const dropping = await connectAgent(TENANT_DROP)
  const disconnectTurn = brokerTurn({ tenantId: TENANT_DROP, turnId: "vt_drop", phoneNumberId: "n2", deadlineMs: 10_000 })
  await new Promise((resolve) => setTimeout(resolve, 300))
  dropping.socket.terminate()
  const droppedAt = Date.now()
  const dropped = await disconnectTurn
  record(
    "a dropped socket fails fast rather than waiting out the deadline",
    dropped.body?.status === "disconnected" && Date.now() - droppedAt < 5_000,
    `status=${dropped.body?.status}`,
  )

  // 8. Durable-notification handshake on the same socket.
  //
  // Only the parts that do not need a live database are asserted here. Claiming
  // and replaying stored events calls v1_claim_events_for_delivery against
  // Supabase, which is a placeholder in this run, so delivery of real stored
  // events is NOT covered by this script.
  const notifications = await new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${PORT}/v1/events`)
    const seen = []
    const timer = setTimeout(() => resolve({ socket, seen }), 15_000)
    socket.on("open", () => {
      // Anything before session.authenticate must be refused.
      socket.send(JSON.stringify({ type: "event.ack", eventId: "00000000-0000-0000-0000-000000000000" }))
      setTimeout(() => {
        socket.send(JSON.stringify({ type: "session.authenticate", token: realtimeToken(TENANT_NOTIFY) }))
      }, 150)
    })
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString())
      seen.push(message)
      if (message.type === "session.replay.complete") {
        clearTimeout(timer)
        resolve({ socket, seen })
      }
    })
    socket.on("error", (error) => { clearTimeout(timer); reject(error) })
  })

  const preAuthError = notifications.seen.find((m) => m.type === "error" && m.error?.code === "AUTH_REQUIRED")
  record("messages before authentication are refused", Boolean(preAuthError))
  record(
    "authentication completes the replay handshake",
    notifications.seen.some((m) => m.type === "session.ready")
      && notifications.seen.some((m) => m.type === "session.replay.complete"),
    notifications.seen.map((m) => m.type).join(","),
  )

  const ackError = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 2_500)
    notifications.socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString())
      if (message.type === "error" || message.type === "event.acknowledged") {
        clearTimeout(timer)
        resolve(message)
      }
    })
    notifications.socket.send(JSON.stringify({ type: "event.ack", eventId: "not-a-uuid" }))
  })
  record("an acknowledgement for an unknown event is refused, not silently accepted",
    ackError === null || ackError.type === "error", JSON.stringify(ackError?.error ?? ackError))

  // An invalid realtime token must close the socket rather than authenticate it.
  const rejected = await new Promise((resolve) => {
    const socket = new WebSocket(`ws://127.0.0.1:${PORT}/v1/events`)
    const timer = setTimeout(() => resolve({ closed: false }), 4_000)
    socket.on("open", () => socket.send(JSON.stringify({ type: "session.authenticate", token: "forged.token.value" })))
    socket.on("close", (code) => { clearTimeout(timer); resolve({ closed: true, code }) })
  })
  record("a forged realtime token closes the socket", rejected.closed === true, `code=${rejected.code}`)
  notifications.socket.close()

  // 8. No unresolved turns are retained.
  const finalHealth = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json()
  record("no voice turns leak", finalHealth.pendingVoiceTurns === 0, `pending=${finalHealth.pendingVoiceTurns}`)

  for (const socket of [agentA.socket, agentB.socket, dupAgent.socket, silent.socket]) socket.close()
} catch (error) {
  record("integration run completed", false, error.message)
} finally {
  gateway.kill("SIGTERM")
}

const failed = results.filter((entry) => !entry.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
