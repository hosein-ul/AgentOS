import { createHmac, randomUUID, timingSafeEqual } from "node:crypto"
import { createServer } from "node:http"
import { createClient } from "@supabase/supabase-js"
import { WebSocket, WebSocketServer } from "ws"

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const required = ["SUPABASE_SERVICE_ROLE_KEY", "REALTIME_GATEWAY_JWT_SECRET"]
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required`)
}
if (!supabaseUrl) throw new Error("SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL is required")

const port = Number(process.env.PORT ?? 8787)
const gatewayId = `gateway_${randomUUID()}`
const db = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const socketsByTenant = new Map()
const deliveryLocks = new Map()

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

const server = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" })
    response.end(JSON.stringify({ ok: true, service: "agentos-realtime-gateway" }))
    return
  }
  response.writeHead(404)
  response.end()
})

const websocketServer = new WebSocketServer({ server, path: "/v1/events" })
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
        })
        await deliverTenant(claims.tenantId)
        send(socket, { type: "session.replay.complete" })
        return
      }
      if (message.type === "event.ack") return await acknowledge(socket, message.eventId)
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
