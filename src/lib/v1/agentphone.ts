import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { lookup } from "node:dns/promises"
import { isIP } from "node:net"
import { ApiError } from "./http"

const DEFAULT_BASE_URL = "https://api.agentphone.ai"
const PROVIDER_TIMEOUT_MS = 15_000

type ProviderErrorBody = {
  detail?: string | Array<{ msg?: string }>
  message?: string
  error?: string
}

export type AgentPhoneAgent = {
  id: string
  name: string
  voiceMode: "webhook"
  createdAt: string
}

export type AgentPhoneNumber = {
  id: string
  phoneNumber: string
  country: string
  status: string
  createdAt: string
  type?: string
  agentId?: string | null
}

export type AgentPhoneCall = {
  id: string
  agentId?: string | null
  phoneNumberId?: string | null
  phoneNumber?: string | null
  fromNumber?: string | null
  toNumber?: string | null
  direction?: "inbound" | "outbound" | "web"
  status: string
  startedAt?: string | null
  endedAt?: string | null
  durationSeconds?: number | null
  transcripts?: Array<{
    id?: string
    transcript?: string
    confidence?: number
    response?: string
    createdAt?: string
  }>
}

export type AgentPhoneWebhookEvent = {
  event: string
  channel?: string
  timestamp?: string
  agentId?: string
  data?: Record<string, unknown>
  recentHistory?: unknown
  conversationState?: unknown
}

type AgentPhoneWebhook = {
  id: string
  url: string
  secret: string
  status: string
}

function baseUrl() {
  const configured = process.env.AGENTPHONE_BASE_URL?.replace(/\/$/, "") || DEFAULT_BASE_URL
  let url: URL
  try {
    url = new URL(configured)
  } catch {
    throw new ApiError("provider_configuration_error", "AGENTPHONE_BASE_URL is invalid", 503)
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new ApiError("provider_configuration_error", "AGENTPHONE_BASE_URL must be HTTPS", 503)
  }
  return url.toString()
}

function apiKey() {
  const key = process.env.AGENTPHONE_API_KEY
  if (!key) throw new ApiError("provider_configuration_error", "AGENTPHONE_API_KEY is not configured", 503)
  return key
}

function providerMessage(body: ProviderErrorBody, status: number) {
  if (typeof body.detail === "string") return body.detail
  if (Array.isArray(body.detail)) return body.detail.map((entry) => entry.msg).filter(Boolean).join("; ")
  return body.message || body.error || `HTTP ${status}`
}

async function agentPhoneRequest<T>(
  path: string,
  init: RequestInit,
  subAccountId?: string | null
): Promise<T> {
  const response = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(subAccountId ? { "X-Sub-Account-Id": subAccountId } : {}),
      ...(init.headers ?? {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  })
  const raw = await response.text()
  let parsed: T | ProviderErrorBody
  try {
    parsed = raw ? JSON.parse(raw) as T | ProviderErrorBody : {} as T
  } catch {
    throw new ApiError(
      "provider_error",
      `AgentPhone returned a non-JSON response (HTTP ${response.status})`,
      502,
    )
  }
  if (!response.ok) {
    throw new ApiError("provider_error", `AgentPhone request failed: ${providerMessage(parsed as ProviderErrorBody, response.status)}`, 502)
  }
  return parsed as T
}

function providerId(value: string, label: string) {
  if (!/^[A-Za-z0-9_-]{3,200}$/.test(value)) throw new ApiError("invalid_request", `Invalid ${label}`)
  return encodeURIComponent(value)
}

export async function createAgentPhoneAgent(input: {
  name: string
  description?: string | null
  beginMessage?: string | null
  voice?: string | null
  language?: string | null
}, subAccountId?: string | null) {
  return agentPhoneRequest<AgentPhoneAgent>("/v1/agents", {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      voiceMode: "webhook",
      ...(input.description ? { description: input.description } : {}),
      ...(input.beginMessage ? { beginMessage: input.beginMessage } : {}),
      ...(input.voice ? { voice: input.voice } : {}),
      language: input.language || "en-US",
      denoisingMode: "noise-cancellation",
      enableBackchannel: true,
      sttMode: "fast",
    }),
  }, subAccountId)
}

export async function deleteAgentPhoneAgent(agentId: string, subAccountId?: string | null) {
  return agentPhoneRequest<Record<string, unknown>>(`/v1/agents/${providerId(agentId, "AgentPhone agent ID")}`, {
    method: "DELETE",
  }, subAccountId)
}

export async function configureAgentPhoneWebhook(
  agentId: string,
  url: string,
  subAccountId?: string | null,
) {
  const webhook = await agentPhoneRequest<AgentPhoneWebhook>(
    `/v1/agents/${providerId(agentId, "AgentPhone agent ID")}/webhook`,
    {
      method: "POST",
      body: JSON.stringify({ url, contextLimit: 50, timeout: 30 }),
    },
    subAccountId,
  )
  if (!webhook.secret || !webhook.url) {
    throw new ApiError("provider_error", "AgentPhone did not return a webhook secret", 502)
  }
  return webhook
}

export async function createAgentPhoneNumber(input: {
  country: "US" | "CA"
  areaCode?: string | null
  agentId: string
}, subAccountId?: string | null) {
  return agentPhoneRequest<AgentPhoneNumber>("/v1/numbers", {
    method: "POST",
    body: JSON.stringify({
      country: input.country,
      ...(input.areaCode ? { areaCode: input.areaCode } : {}),
      agentId: input.agentId,
    }),
  }, subAccountId)
}

export async function getAgentPhoneNumber(numberId: string, subAccountId?: string | null) {
  return agentPhoneRequest<AgentPhoneNumber>(`/v1/numbers/${providerId(numberId, "AgentPhone number ID")}`, {
    method: "GET",
  }, subAccountId)
}

export async function releaseAgentPhoneNumber(numberId: string, subAccountId?: string | null) {
  return agentPhoneRequest<Record<string, unknown>>(`/v1/numbers/${providerId(numberId, "AgentPhone number ID")}`, {
    method: "DELETE",
  }, subAccountId)
}

export async function createAgentPhoneCall(input: {
  agentId: string
  fromNumberId: string
  toNumber: string
  initialGreeting?: string | null
}, subAccountId?: string | null) {
  const response = await agentPhoneRequest<Record<string, unknown>>("/v1/calls", {
    method: "POST",
    body: JSON.stringify({
      agentId: input.agentId,
      fromNumberId: input.fromNumberId,
      toNumber: input.toNumber,
      ...(input.initialGreeting ? { initialGreeting: input.initialGreeting } : {}),
    }),
  }, subAccountId)
  const id = typeof response.id === "string"
    ? response.id
    : typeof response.callId === "string"
      ? response.callId
      : null
  if (!id) throw new ApiError("provider_error", "AgentPhone accepted the call without returning a call ID", 502)
  return { id, status: typeof response.status === "string" ? response.status : "initiated" }
}

export async function getAgentPhoneCall(callId: string, subAccountId?: string | null) {
  const call = await agentPhoneRequest<AgentPhoneCall>(`/v1/calls/${providerId(callId, "AgentPhone call ID")}`, {
    method: "GET",
  }, subAccountId)
  return sanitizeAgentPhoneCall(call)
}

export async function endAgentPhoneCall(callId: string, subAccountId?: string | null) {
  const call = await agentPhoneRequest<AgentPhoneCall>(`/v1/calls/${providerId(callId, "AgentPhone call ID")}/end`, {
    method: "POST",
  }, subAccountId)
  return sanitizeAgentPhoneCall(call)
}

export async function getAgentPhoneTranscript(callId: string, subAccountId?: string | null) {
  const response = await agentPhoneRequest<unknown>(`/v1/calls/${providerId(callId, "AgentPhone call ID")}/transcript`, {
    method: "GET",
  }, subAccountId)
  return stripProviderMediaFields(response)
}

export function sanitizeAgentPhoneCall(call: AgentPhoneCall): AgentPhoneCall {
  return {
    id: call.id,
    agentId: call.agentId ?? null,
    phoneNumberId: call.phoneNumberId ?? null,
    phoneNumber: call.phoneNumber ?? null,
    fromNumber: call.fromNumber ?? null,
    toNumber: call.toNumber ?? null,
    direction: call.direction,
    status: call.status,
    startedAt: call.startedAt ?? null,
    endedAt: call.endedAt ?? null,
    durationSeconds: call.durationSeconds ?? null,
    transcripts: call.transcripts,
  }
}

export function stripProviderMediaFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripProviderMediaFields)
  if (!value || typeof value !== "object") return value
  const result: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (/^recording/i.test(key) || key === "audioUrl" || key === "audio_url") continue
    result[key] = stripProviderMediaFields(nested)
  }
  return result
}

export function verifyAgentPhoneWebhook(rawBody: string, headers: Headers, secret: string) {
  const signature = headers.get("x-webhook-signature")
  const timestamp = headers.get("x-webhook-timestamp")
  const webhookId = headers.get("x-webhook-id")
  if (!signature || !timestamp || !webhookId) throw new ApiError("forbidden", "Missing AgentPhone webhook authentication", 401)
  const seconds = Number(timestamp)
  if (!Number.isFinite(seconds) || Math.abs(Date.now() / 1000 - seconds) > 300) {
    throw new ApiError("forbidden", "Stale AgentPhone webhook", 401)
  }
  if (!secret) throw new ApiError("provider_configuration_error", "AgentPhone webhook verification secret is unavailable", 503)
  const expected = `sha256=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`
  const left = Buffer.from(signature)
  const right = Buffer.from(expected)
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new ApiError("forbidden", "Invalid AgentPhone webhook signature", 401)
  }
  return webhookId
}

function privateIpv4(ip: string) {
  const parts = ip.split(".").map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  return parts[0] === 10
    || parts[0] === 127
    || parts[0] === 0
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
}

function privateIp(ip: string) {
  if (isIP(ip) === 4) return privateIpv4(ip)
  if (isIP(ip) === 6) {
    const normalized = ip.toLowerCase()
    return normalized === "::1"
      || normalized === "::"
      || normalized.startsWith("fc")
      || normalized.startsWith("fd")
      || normalized.startsWith("fe8")
      || normalized.startsWith("fe9")
      || normalized.startsWith("fea")
      || normalized.startsWith("feb")
  }
  return true
}

export async function requireSafeAgentWebhookUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 2083) throw new ApiError("invalid_request", "agentWebhookUrl is required")
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new ApiError("invalid_request", "agentWebhookUrl must be a valid URL")
  }
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname) {
    throw new ApiError("invalid_request", "agentWebhookUrl must be a public HTTPS URL")
  }
  if (url.hostname.toLowerCase() === "localhost" || privateIp(url.hostname)) {
    throw new ApiError("invalid_request", "agentWebhookUrl cannot target a private host")
  }
  let addresses: Array<{ address: string }>
  try {
    addresses = await lookup(url.hostname, { all: true })
  } catch {
    throw new ApiError("invalid_request", "agentWebhookUrl hostname could not be resolved")
  }
  if (!addresses.length || addresses.some(({ address }) => privateIp(address))) {
    throw new ApiError("invalid_request", "agentWebhookUrl resolves to a private address")
  }
  return url.toString()
}

export function newAgentCallbackSecret() {
  return `whsec_agentos_${randomBytes(32).toString("base64url")}`
}

export async function callAgentWebhook(input: {
  url: string
  callbackSecret: string
  event: AgentPhoneWebhookEvent
}) {
  const safeUrl = await requireSafeAgentWebhookUrl(input.url)
  const payload = JSON.stringify(stripProviderMediaFields(input.event))
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = createHmac("sha256", input.callbackSecret).update(`${timestamp}.${payload}`).digest("hex")
  return fetch(safeUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agentos-timestamp": timestamp,
      "x-agentos-signature": `sha256=${signature}`,
    },
    body: payload,
    redirect: "error",
    signal: AbortSignal.timeout(25_000),
  })
}

export async function safeVoiceWebhookResponse(response: Response) {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? ""
  if (contentType.includes("application/x-ndjson")) {
    if (!response.body) throw new ApiError("provider_error", "Agent voice webhook returned an empty stream", 502)
    return new Response(response.body, {
      status: 200,
      headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
    })
  }
  const body = await response.json().catch(() => null)
  if (!response.ok || !body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError("provider_error", "Agent voice webhook must return a JSON object or NDJSON stream", 502)
  }
  const source = body as Record<string, unknown>
  const allowed: Record<string, unknown> = {}
  for (const key of ["text", "hangup", "action", "digits", "send_message", "interim"]) {
    if (key in source) allowed[key] = source[key]
  }
  if (typeof allowed.text !== "string" && allowed.hangup !== true && allowed.action !== "hangup") {
    throw new ApiError("provider_error", "Agent voice webhook response did not contain a valid voice action", 502)
  }
  return Response.json(allowed, { headers: { "cache-control": "no-store" } })
}
