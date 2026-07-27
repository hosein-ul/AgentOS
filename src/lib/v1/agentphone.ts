import { createHmac, timingSafeEqual } from "node:crypto"
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
