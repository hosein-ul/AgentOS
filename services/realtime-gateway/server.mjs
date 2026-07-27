import { createHmac, randomUUID, timingSafeEqual } from "node:crypto"
import { createServer } from "node:http"
import { createClient } from "@supabase/supabase-js"
import { WebSocket, WebSocketServer } from "ws"
import {
  VOICE_CANCEL_MESSAGE,
  VOICE_RESPONSE_MESSAGE,
  VoiceTurnRegistry,
} from "./voice-turns.mjs"

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const required = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "REALTIME_GATEWAY_JWT_SECRET",
  "REALTIME_GATEWAY_INTERNAL_SECRET",
]
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required`)
}
if (process.env.REALTIME_GATEWAY_INTERNAL_SECRET.length < 32) {
  throw new Error("REALTIME_GATEWAY_INTERNAL_SECRET must be at least 32 characters")
}
if (!supabaseUrl) throw new Error("SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL is required")

const port = Number(process.env.PORT ?? 8787)
const gatewayId = `gateway_${randomUUID()}`
// Bound every inbound frame; an agent cannot exhaust gateway memory with one message.
const MAX_WS_PAYLOAD_BYTES = 256 * 1024
const MAX_BROKER_BODY_BYTES = 64 * 1024
const SIGNATURE_TOLERANCE_SECONDS = 120
// Replay must terminate even if the database is slow or unreachable.
const REPLAY_TIMEOUT_MS = 10_000
// The broker endpoint must be internet-reachable so Vercel can call it, so it is
// rate limited in addition to requiring a valid HMAC. A real AgentPhone call
// produces a handful of turns per second at most; this only stops abuse.
const BROKER_RATE_LIMIT = 60
const BROKER_RATE_WINDOW_MS = 10_000
const db = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const socketsByTenant = new Map()
const deliveryLocks = new Map()
const voiceTurns = new VoiceTurnRegistry()

function send(socket, value) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value))
}

function verifyToken(token) {
  const parts = typeof token === "string" ? token.split(".") : []
  if (parts.length !== 3) return null
  const [header, payload, signature] = parts
  const expected = createHmac("sha256", process.env.REALTIME_GATEWAY_JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest()
  const actual = Buffer.from(signature, "base64url")
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
    if (
      claims.aud !== "agentos-realtime"
      || typeof claims.sub !== "string"
      || typeof claims.exp !== "number"
      || claims.exp <= Math.floor(Date.now() / 1000)
    ) return null
    return { tenantId: claims.sub, expiresAt: claims.exp }
  } catch {
    return null
  }
}

function publicEvent(row) {
  return {
    eventId: row.id,
    type: row.type,
    service: row.service,
    agentId: row.agent_id,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    payload: row.payload,
    status: row.status,
    createdAt: row.created_at,
    availableAt: row.available_at,
    deliveredAt: row.delivered_at,
    acknowledgedAt: row.acknowledged_at,
    expiresAt: row.expires_at,
    deliveryAttempts: row.delivery_attempts,
  }
}

async function deliverTenant(tenantId) {
  const prior = deliveryLocks.get(tenantId) ?? Promise.resolve()
  const current = prior.catch(() => undefined).then(async () => {
    const sockets = [...(socketsByTenant.get(tenantId) ?? [])]
      .filter((socket) => socket.readyState === WebSocket.OPEN && socket.tenantId === tenantId)
    if (!sockets.length) return
    const { data, error } = await db.rpc("v1_claim_events_for_delivery", {
      p_tenant_id: tenantId,
      p_delivered_by: gatewayId,
      p_limit: 100,
      p_lease_seconds: 60,
    })
    if (error) throw new Error(`Event claim failed: ${error.message}`)
    for (const row of data ?? []) {
      const socket = sockets[0]
      if (!socket) break
      send(socket, { type: "event.delivery", event: publicEvent(row) })
    }
  }).finally(() => {
    if (deliveryLocks.get(tenantId) === current) deliveryLocks.delete(tenantId)
  })
  deliveryLocks.set(tenantId, current)
  return current
}

async function acknowledge(socket, eventId) {
  if (typeof eventId !== "string") {
    return send(socket, { type: "error", error: { code: "INVALID_REQUEST", message: "eventId is required" } })
  }
  const { data: existing, error: lookupError } = await db.from("v1_events")
    .select("id,status,acknowledged_at")
    .eq("id", eventId)
    .eq("tenant_id", socket.tenantId)
    .maybeSingle()
  if (lookupError) throw lookupError
  if (!existing) {
    return send(socket, { type: "error", error: { code: "RESOURCE_NOT_FOUND", message: "Event not found" } })
  }
  if (existing.status === "acknowledged") {
    return send(socket, { type: "event.acknowledged", eventId, acknowledgedAt: existing.acknowledged_at, idempotentReplay: true })
  }
  if (existing.status === "expired") {
    return send(socket, { type: "error", error: { code: "RESOURCE_NOT_FOUND", message: "Expired event cannot be acknowledged" } })
  }
  const acknowledgedAt = new Date().toISOString()
  const { error } = await db.from("v1_events").update({
    status: "acknowledged",
    acknowledged_at: acknowledgedAt,
    delivery_lease_until: null,
  }).eq("id", eventId).eq("tenant_id", socket.tenantId)
  if (error) throw error
  send(socket, { type: "event.acknowledged", eventId, acknowledgedAt })
}

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" })
  response.end(JSON.stringify(body))
}

const brokerHits = []

// Fixed-window counter over a bounded array. Unauthenticated floods are dropped
// before the HMAC is computed, so signature verification cannot be used as a
// CPU amplification vector.
function brokerRateLimited() {
  const now = Date.now()
  while (brokerHits.length && now - brokerHits[0] > BROKER_RATE_WINDOW_MS) brokerHits.shift()
  if (brokerHits.length >= BROKER_RATE_LIMIT) return true
  brokerHits.push(now)
  return false
}

function verifyBrokerSignature(rawBody, headers) {
  const signature = headers["x-agentos-signature"]
  const timestamp = headers["x-agentos-timestamp"]
  if (typeof signature !== "string" || typeof timestamp !== "string") return false
  const seconds = Number(timestamp)
  if (!Number.isFinite(seconds) || Math.abs(Date.now() / 1000 - seconds) > SIGNATURE_TOLERANCE_SECONDS) return false
  const expected = Buffer.from(
    `sha256=${createHmac("sha256", process.env.REALTIME_GATEWAY_INTERNAL_SECRET)
      .update(`${timestamp}.${rawBody}`)
      .digest("hex")}`,
  )
  const actual = Buffer.from(signature)
  return expected.length === actual.length && timingSafeEqual(actual, expected)
}

function readBoundedBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    request.on("data", (chunk) => {
      size += chunk.length
      if (size > MAX_BROKER_BODY_BYTES) {
        reject(new Error("body_too_large"))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    request.on("error", reject)
  })
}

function liveSocketForTenant(tenantId) {
  for (const socket of socketsByTenant.get(tenantId) ?? []) {
    if (socket.readyState === WebSocket.OPEN && socket.tenantId === tenantId) return socket
  }
  return null
}

// Internal broker hop. AgentOS holds the AgentPhone webhook open and asks the
// gateway to run one live turn against the tenant's connected Agent socket.
// Authenticated with a shared HMAC; never exposed to customers.
async function handleVoiceTurn(request, response) {
  if (brokerRateLimited()) {
    return json(response, 429, { status: "unavailable", reason: "rate_limited" })
  }
  let raw
  try {
    raw = await readBoundedBody(request)
  } catch {
    return json(response, 413, { status: "invalid", reason: "body_too_large" })
  }
  if (!verifyBrokerSignature(raw, request.headers)) {
    return json(response, 401, { status: "invalid", reason: "bad_signature" })
  }
  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    return json(response, 400, { status: "invalid", reason: "invalid_json" })
  }
  const tenantId = payload?.tenantId
  const turnId = payload?.turnId
  if (typeof tenantId !== "string" || !tenantId || typeof turnId !== "string" || !turnId) {
    return json(response, 400, { status: "invalid", reason: "tenant_and_turn_required" })
  }

  const socket = liveSocketForTenant(tenantId)
  if (!socket) return json(response, 200, { status: "no_socket", reason: "no_authenticated_socket" })

  const result = await voiceTurns.open({
    turnId,
    tenantId,
    socket,
    send,
    deadlineMs: payload.deadlineMs,
    callId: payload.callId,
    phoneNumberId: payload.phoneNumberId,
    providerCallId: payload.providerCallId,
    direction: payload.direction,
    fromNumber: payload.fromNumber,
    toNumber: payload.toNumber,
    transcript: payload.transcript,
    event: payload.event,
  })
  return json(response, 200, result)
}

const server = createServer((request, response) => {
  if (request.url === "/health") {
    return json(response, 200, {
      ok: true,
      service: "agentos-realtime-gateway",
      pendingVoiceTurns: voiceTurns.size,
      connectedTenants: socketsByTenant.size,
    })
  }
  if (request.url === "/internal/voice/turn" && request.method === "POST") {
    handleVoiceTurn(request, response).catch(() => {
      json(response, 500, { status: "unavailable", reason: "gateway_error" })
    })
    return
  }
  response.writeHead(404)
  response.end()
})

const websocketServer = new WebSocketServer({
  server,
  path: "/v1/events",
  maxPayload: MAX_WS_PAYLOAD_BYTES,
})
websocketServer.on("connection", (socket) => {
  const authDeadline = setTimeout(() => socket.close(4401, "Authentication timeout"), 10_000)
  socket.on("message", async (raw) => {
    try {
      const message = JSON.parse(raw.toString())
      if (!socket.tenantId) {
        if (message.type !== "session.authenticate") {
          return send(socket, { type: "error", error: { code: "AUTH_REQUIRED", message: "Authenticate the session first" } })
        }
        const claims = verifyToken(message.token)
        if (!claims) return socket.close(4401, "Invalid or expired realtime token")
        clearTimeout(authDeadline)
        socket.tenantId = claims.tenantId
        const tenantSockets = socketsByTenant.get(claims.tenantId) ?? new Set()
        tenantSockets.add(socket)
        socketsByTenant.set(claims.tenantId, tenantSockets)
        send(socket, {
          type: "session.ready",
          tenantScoped: true,
          replay: "starting",
          tokenExpiresAt: new Date(claims.expiresAt * 1000).toISOString(),
          protocols: {
            // Durable: stored, replayed after reconnect, explicitly acknowledged.
            notifications: { delivery: "event.delivery", acknowledge: "event.ack" },
            // Synchronous: a caller is on the line. Never stored, never replayed.
            voice: {
              turn: "voice.turn",
              respond: "voice.response",
              cancel: "voice.cancel",
              expired: "voice.timeout",
            },
          },
        })
        // Replay must always be terminated. A failed claim previously threw past
        // this point, leaving an agent that waits for session.replay.complete
        // hanging forever. Report the outcome instead; nothing is lost, because
        // undelivered events stay in the durable inbox and are retried by the
        // sweep, by the next reconnect, or through the REST fallback.
        let replay = "complete"
        try {
          // Bounded: a slow or unreachable database must not leave the agent
          // waiting on a replay signal that never arrives.
          await Promise.race([
            deliverTenant(claims.tenantId),
            new Promise((_resolve, reject) =>
              setTimeout(() => reject(new Error("Event replay timed out")), REPLAY_TIMEOUT_MS).unref?.(),
            ),
          ])
        } catch (error) {
          replay = "deferred"
          send(socket, {
            type: "error",
            error: {
              code: "REPLAY_UNAVAILABLE",
              message: error instanceof Error ? error.message : "Event replay failed",
              recovery: "Events remain in the durable inbox. Retry over the socket or use POST /api/v1/events/list.",
            },
          })
        }
        send(socket, { type: "session.replay.complete", replay })
        return
      }
      if (message.type === "event.ack") return await acknowledge(socket, message.eventId)
      if (message.type === VOICE_RESPONSE_MESSAGE) {
        const outcome = voiceTurns.resolve(socket, message)
        if (!outcome.ok) {
          return send(socket, {
            type: "error",
            error: { code: "VOICE_RESPONSE_REJECTED", message: outcome.reason, turnId: message.turnId ?? null },
          })
        }
        return send(socket, { type: "voice.accepted", turnId: outcome.turnId })
      }
      if (message.type === VOICE_CANCEL_MESSAGE) {
        const outcome = voiceTurns.cancel(socket, message)
        if (!outcome.ok) {
          return send(socket, {
            type: "error",
            error: { code: "VOICE_CANCEL_REJECTED", message: outcome.reason, turnId: message.turnId ?? null },
          })
        }
        return send(socket, { type: "voice.accepted", turnId: outcome.turnId, canceled: true })
      }
      if (message.type === "session.ping") return send(socket, { type: "session.pong", at: new Date().toISOString() })
      send(socket, { type: "error", error: { code: "INVALID_REQUEST", message: "Unsupported WebSocket message type" } })
    } catch (error) {
      send(socket, {
        type: "error",
        error: { code: "INTERNAL_ERROR", message: error instanceof Error ? error.message : "Request failed" },
      })
    }
  })
  socket.on("close", () => {
    clearTimeout(authDeadline)
    // Settle every turn still waiting on this socket so AgentPhone gets a
    // fallback immediately instead of waiting out the deadline.
    voiceTurns.failSocket(socket)
    if (!socket.tenantId) return
    const tenantSockets = socketsByTenant.get(socket.tenantId)
    tenantSockets?.delete(socket)
    if (!tenantSockets?.size) socketsByTenant.delete(socket.tenantId)
  })
})

const changes = db.channel("agentos-event-gateway")
  .on("postgres_changes", { event: "INSERT", schema: "public", table: "v1_events" }, (change) => {
    const tenantId = change.new?.tenant_id
    if (typeof tenantId === "string") void deliverTenant(tenantId)
  })
  .subscribe()

const sweep = setInterval(() => {
  for (const tenantId of socketsByTenant.keys()) void deliverTenant(tenantId)
}, 15_000)

async function shutdown() {
  clearInterval(sweep)
  await db.removeChannel(changes)
  for (const socket of websocketServer.clients) socket.close(1001, "Server shutdown")
  server.close()
}
process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)
server.listen(port, () => console.log(`AgentOS realtime gateway listening on ${port}`))
