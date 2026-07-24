import { createHmac, timingSafeEqual } from "node:crypto"
import { requireServerSupabase } from "@/lib/supabase"
import { ApiError } from "./http"
import type { Tenant } from "./auth"

export type EventStatus = "pending" | "delivered" | "acknowledged" | "expired" | "failed"

export type DurableEvent = {
  id: string
  eventId: string
  type: string
  service: string
  agentId: string | null
  resourceType: string | null
  resourceId: string | null
  payload: Record<string, unknown>
  status: EventStatus
  availableAt: string
  deliveredAt: string | null
  acknowledgedAt: string | null
  expiresAt: string | null
  deliveryAttempts: number
  createdAt: string
}

type EventListInput = {
  status?: EventStatus
  types?: string[]
  agentId?: string
  service?: string
  resourceId?: string
  from?: string
  to?: string
  limit?: number
  cursor?: string
}

function mapEvent(row: Record<string, unknown>): DurableEvent {
  const id = String(row.id)
  return {
    id,
    eventId: id,
    type: String(row.type),
    service: typeof row.service === "string" ? row.service : "system",
    agentId: typeof row.agent_id === "string" ? row.agent_id : null,
    resourceType: typeof row.resource_type === "string" ? row.resource_type : null,
    resourceId: typeof row.resource_id === "string" ? row.resource_id : null,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    status: row.status as EventStatus,
    availableAt: String(row.available_at),
    deliveredAt: typeof row.delivered_at === "string" ? row.delivered_at : null,
    acknowledgedAt: typeof row.acknowledged_at === "string" ? row.acknowledged_at : null,
    expiresAt: typeof row.expires_at === "string" ? row.expires_at : null,
    deliveryAttempts: Number(row.delivery_attempts ?? row.delivery_count ?? 0),
    createdAt: String(row.created_at),
  }
}

function parseDate(value: unknown, field: string) {
  if (value === undefined) return undefined
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new ApiError("INVALID_REQUEST", `${field} must be an ISO-8601 timestamp`, 400)
  }
  return new Date(value).toISOString()
}

function encodeCursor(event: DurableEvent) {
  return Buffer.from(JSON.stringify({ createdAt: event.createdAt, id: event.id })).toString("base64url")
}

function decodeCursor(value: string) {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      createdAt?: unknown
      id?: unknown
    }
    if (
      typeof parsed.createdAt !== "string"
      || typeof parsed.id !== "string"
      || !Number.isFinite(Date.parse(parsed.createdAt))
    ) throw new Error("invalid")
    return { createdAt: new Date(parsed.createdAt).toISOString(), id: parsed.id }
  } catch {
    throw new ApiError("INVALID_REQUEST", "cursor is invalid", 400)
  }
}

async function expireTenantEvents(tenantId: string) {
  const now = new Date().toISOString()
  const { error } = await requireServerSupabase()
    .from("v1_events")
    .update({ status: "expired", delivery_lease_until: null })
    .eq("tenant_id", tenantId)
    .in("status", ["pending", "delivered"])
    .not("expires_at", "is", null)
    .lte("expires_at", now)
  if (error) throw new Error(`Event expiry scan failed: ${error.message}`)
}

export async function createDurableEvent(input: {
  tenantId: string
  eventKey: string
  type: string
  service?: "email" | "phone" | "domain" | "billing" | "credentials" | "system"
  agentId?: string
  resourceType?: string
  resourceId?: string
  payload: Record<string, unknown>
  availableAt?: string
  expiresAt?: string
}) {
  const service = input.service ?? input.type.split(".", 1)[0] ?? "system"
  const db = requireServerSupabase()
  const { data, error } = await db
    .from("v1_events")
    .upsert({
      tenant_id: input.tenantId,
      event_key: input.eventKey,
      type: input.type,
      service,
      agent_id: input.agentId ?? null,
      resource_type: input.resourceType ?? null,
      resource_id: input.resourceId ?? null,
      payload: input.payload,
      available_at: input.availableAt ?? new Date().toISOString(),
      expires_at: input.expiresAt ?? null,
    }, { onConflict: "event_key", ignoreDuplicates: true })
    .select("*")
    .maybeSingle()
  if (error) throw new Error(`Event inbox write failed: ${error.message}`)
  if (data) return mapEvent(data as Record<string, unknown>)
  const { data: existing, error: lookupError } = await db
    .from("v1_events")
    .select("*")
    .eq("event_key", input.eventKey)
    .single()
  if (lookupError || !existing) {
    throw new Error(`Event inbox lookup failed: ${lookupError?.message ?? "missing event"}`)
  }
  return mapEvent(existing as Record<string, unknown>)
}

export async function listEvents(tenant: Tenant, input: EventListInput = {}) {
  await expireTenantEvents(tenant.id)
  const statuses: EventStatus[] = ["pending", "delivered", "acknowledged", "expired", "failed"]
  if (input.status && !statuses.includes(input.status)) {
    throw new ApiError("INVALID_REQUEST", "status is invalid", 400)
  }
  const limit = Math.max(1, Math.min(Number(input.limit ?? 50), 100))
  if (!Number.isInteger(limit)) throw new ApiError("INVALID_REQUEST", "limit must be an integer", 400)
  const from = parseDate(input.from, "from")
  const to = parseDate(input.to, "to")
  const cursor = input.cursor ? decodeCursor(input.cursor) : null
  let query = requireServerSupabase()
    .from("v1_events")
    .select("*")
    .eq("tenant_id", tenant.id)
    .lte("available_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit + 1)
  if (input.status) query = query.eq("status", input.status)
  if (input.types?.length) query = query.in("type", input.types.slice(0, 50))
  if (input.agentId) query = query.eq("agent_id", input.agentId)
  if (input.service) query = query.eq("service", input.service)
  if (input.resourceId) query = query.eq("resource_id", input.resourceId)
  if (from) query = query.gte("created_at", from)
  if (to) query = query.lte("created_at", to)
  if (cursor) {
    query = query.or(`created_at.gt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.gt.${cursor.id})`)
  }
  const { data, error } = await query
  if (error) throw new Error(`Event inbox query failed: ${error.message}`)
  const mapped = (data ?? []).map((row) => mapEvent(row as Record<string, unknown>))
  const hasMore = mapped.length > limit
  const items = mapped.slice(0, limit)
  return {
    items,
    nextCursor: hasMore && items.length ? encodeCursor(items[items.length - 1]) : null,
  }
}

export async function listPendingEvents(tenant: Tenant, limit = 100) {
  await expireTenantEvents(tenant.id)
  const { data, error } = await requireServerSupabase()
    .from("v1_events")
    .select("*")
    .eq("tenant_id", tenant.id)
    .in("status", ["pending", "delivered"])
    .lte("available_at", new Date().toISOString())
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(Math.max(1, Math.min(limit, 100)))
  if (error) throw new Error(`Event replay query failed: ${error.message}`)
  return (data ?? []).map((row) => mapEvent(row as Record<string, unknown>))
}

export async function getEvent(tenant: Tenant, eventId: string) {
  const { data, error } = await requireServerSupabase()
    .from("v1_events")
    .select("*")
    .eq("id", eventId)
    .eq("tenant_id", tenant.id)
    .maybeSingle()
  if (error) throw new Error(`Event inbox lookup failed: ${error.message}`)
  if (!data) throw new ApiError("RESOURCE_NOT_FOUND", "Event not found", 404)
  return mapEvent(data as Record<string, unknown>)
}

export async function acknowledgeEvent(tenant: Tenant, eventId: string) {
  const existing = await getEvent(tenant, eventId)
  if (existing.status === "acknowledged") return existing
  if (existing.status === "expired") {
    throw new ApiError("RESOURCE_NOT_FOUND", "Expired events cannot be acknowledged", 404)
  }
  const now = new Date().toISOString()
  const { data, error } = await requireServerSupabase()
    .from("v1_events")
    .update({
      status: "acknowledged",
      acknowledged_at: now,
      delivery_lease_until: null,
    })
    .eq("id", eventId)
    .eq("tenant_id", tenant.id)
    .neq("status", "expired")
    .select("*")
    .maybeSingle()
  if (error) throw new Error(`Event acknowledgement failed: ${error.message}`)
  if (!data) throw new ApiError("RESOURCE_NOT_FOUND", "Event not found", 404)
  return mapEvent(data as Record<string, unknown>)
}

export async function acknowledgeAllEvents(
  tenant: Tenant,
  input: { before?: unknown; types?: unknown; service?: unknown },
) {
  const before = parseDate(input.before, "before")
  if (!before) throw new ApiError("INVALID_REQUEST", "before is required", 400)
  let query = requireServerSupabase()
    .from("v1_events")
    .update({
      status: "acknowledged",
      acknowledged_at: new Date().toISOString(),
      delivery_lease_until: null,
    })
    .eq("tenant_id", tenant.id)
    .in("status", ["pending", "delivered"])
    .lte("created_at", before)
  if (Array.isArray(input.types) && input.types.length) {
    query = query.in("type", input.types.filter((value): value is string => typeof value === "string").slice(0, 50))
  }
  if (typeof input.service === "string" && input.service) query = query.eq("service", input.service)
  const { data, error } = await query.select("id")
  if (error) throw new Error(`Bulk event acknowledgement failed: ${error.message}`)
  return { acknowledged: data?.length ?? 0, before }
}

function base64url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url")
}

function signingSecret() {
  const secret = process.env.REALTIME_GATEWAY_JWT_SECRET ?? process.env.SUPABASE_JWT_SECRET
  if (!secret) {
    throw new ApiError("PROVIDER_CONFIGURATION_ERROR", "Realtime gateway signing secret is not configured", 503)
  }
  return secret
}

export function issueRealtimeToken(tenant: Tenant) {
  const now = Math.floor(Date.now() / 1000)
  const expiresAt = now + 15 * 60
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))
  const payload = base64url(JSON.stringify({
    aud: "agentos-realtime",
    exp: expiresAt,
    iat: now,
    iss: "agentos",
    sub: tenant.id,
    wallet_address: tenant.walletAddress,
  }))
  const signature = createHmac("sha256", signingSecret()).update(`${header}.${payload}`).digest("base64url")
  const websocketUrl = process.env.REALTIME_GATEWAY_URL
  if (!websocketUrl?.startsWith("wss://") && process.env.NODE_ENV === "production") {
    throw new ApiError("PROVIDER_CONFIGURATION_ERROR", "REALTIME_GATEWAY_URL must be a production wss:// URL", 503)
  }
  return {
    token: `${header}.${payload}.${signature}`,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
    websocketUrl: websocketUrl ?? "ws://localhost:8787",
    protocol: {
      authenticate: { type: "session.authenticate", token: "<realtime token>" },
      ready: "session.ready",
      delivery: "event.delivery",
      acknowledge: { type: "event.ack", eventId: "<event UUID>" },
    },
  }
}

export function verifyRealtimeToken(token: string) {
  const [header, payload, signature] = token.split(".")
  if (!header || !payload || !signature) return null
  const expected = createHmac("sha256", signingSecret()).update(`${header}.${payload}`).digest()
  const actual = Buffer.from(signature, "base64url")
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      aud?: string
      exp?: number
      sub?: string
    }
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
