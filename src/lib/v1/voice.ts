import { createHmac, randomUUID, timingSafeEqual } from "node:crypto"

// Synchronous live-voice turns. AgentPhone holds the phone call open while this
// runs, so every path here is bounded and always produces a voice reply.
//
// AgentPhone -> AgentOS provider webhook -> realtime gateway -> customer Agent
// socket -> customer Agent reply -> AgentOS -> AgentPhone TTS.
//
// This is NOT the durable event inbox. Durable lifecycle events such as
// phone.call.ended are still written to v1_events and delivered/replayed/acked
// over the notification protocol. A voice turn is never persisted or replayed.

export const VOICE_TURN_DEADLINE_MS = 8_000
export const VOICE_BROKER_MARGIN_MS = 2_000
export const VOICE_SIGNATURE_TOLERANCE_SECONDS = 120

export type VoiceTurnStatus =
  | "answered"
  | "timeout"
  | "canceled"
  | "disconnected"
  | "no_socket"
  | "overloaded"
  | "invalid"
  | "unavailable"

export type VoiceReply = {
  text?: string
  hangup?: boolean
  action?: "hangup" | "continue"
  digits?: string
}

export type VoiceTurnResult = {
  status: VoiceTurnStatus
  reason?: string
  response?: VoiceReply
}

export type VoiceTurnRequest = {
  tenantId: string
  callId: string | null
  phoneNumberId: string
  providerCallId: string | null
  direction: string | null
  fromNumber: string | null
  toNumber: string | null
  transcript: string | null
  event: string
  deadlineMs?: number
}

/**
 * Safe fallback spoken to the caller when the customer Agent does not produce a
 * usable answer. Anything that leaves the agent unreachable ends the call rather
 * than leaving a caller in silence; a single slow turn keeps the call alive.
 */
export function voiceFallback(status: VoiceTurnStatus): VoiceReply {
  switch (status) {
    case "timeout":
      return { text: "Sorry, I did not catch that. Could you say it again?", hangup: false }
    case "canceled":
      return { text: "Sorry, I cannot help with that right now.", hangup: false }
    case "no_socket":
    case "disconnected":
      return { text: "The agent for this number is not connected right now. Please try again later.", hangup: true }
    case "overloaded":
      return { text: "This number is busy right now. Please try again shortly.", hangup: true }
    default:
      return { text: "Sorry, something went wrong on our side. Please try again later.", hangup: true }
  }
}

function internalSecret() {
  const secret = process.env.REALTIME_GATEWAY_INTERNAL_SECRET
  if (!secret || secret.length < 32) {
    // Caught by requestVoiceTurn and reported as an "unavailable" turn, so a
    // misconfigured gateway still produces a safe spoken fallback.
    throw new Error("REALTIME_GATEWAY_INTERNAL_SECRET must be configured for live voice")
  }
  return secret
}

function internalUrl() {
  const configured = process.env.REALTIME_GATEWAY_INTERNAL_URL
  if (!configured) {
    throw new Error("REALTIME_GATEWAY_INTERNAL_URL must be configured for live voice")
  }
  let url: URL
  try {
    url = new URL(configured)
  } catch {
    throw new Error("REALTIME_GATEWAY_INTERNAL_URL is invalid")
  }
  if (url.username || url.password) {
    throw new Error("REALTIME_GATEWAY_INTERNAL_URL must not embed credentials")
  }
  if (url.protocol !== "https:" && process.env.NODE_ENV === "production") {
    throw new Error("REALTIME_GATEWAY_INTERNAL_URL must be HTTPS in production")
  }
  return new URL("/internal/voice/turn", url).toString()
}

export function signVoiceBrokerRequest(body: string, timestamp: string, secret: string) {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`
}

/**
 * Constant-time verification used by the gateway side of the broker hop. Exposed
 * here so the signing and verifying halves stay provably symmetric in tests.
 */
export function verifyVoiceBrokerSignature(input: {
  body: string
  timestamp: string
  signature: string
  secret: string
  nowSeconds?: number
}) {
  const seconds = Number(input.timestamp)
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000)
  if (!Number.isFinite(seconds) || Math.abs(now - seconds) > VOICE_SIGNATURE_TOLERANCE_SECONDS) return false
  const expected = Buffer.from(signVoiceBrokerRequest(input.body, input.timestamp, input.secret))
  const actual = Buffer.from(input.signature)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export function newVoiceTurnId() {
  return `vt_${randomUUID()}`
}

/**
 * Ask the gateway to run one live turn against the tenant's connected Agent.
 * Always resolves; transport problems become a terminal status, never a throw,
 * so the webhook can still answer AgentPhone in time.
 */
export async function requestVoiceTurn(input: VoiceTurnRequest): Promise<VoiceTurnResult & { turnId: string }> {
  const turnId = newVoiceTurnId()
  const deadlineMs = input.deadlineMs ?? VOICE_TURN_DEADLINE_MS
  let url: string
  let secret: string
  try {
    url = internalUrl()
    secret = internalSecret()
  } catch {
    return { turnId, status: "unavailable", reason: "gateway_not_configured" }
  }

  const body = JSON.stringify({ ...input, turnId, deadlineMs })
  const timestamp = String(Math.floor(Date.now() / 1000))

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agentos-timestamp": timestamp,
        "x-agentos-signature": signVoiceBrokerRequest(body, timestamp, secret),
      },
      body,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(deadlineMs + VOICE_BROKER_MARGIN_MS),
    })
    if (!response.ok) {
      return { turnId, status: "unavailable", reason: `gateway_http_${response.status}` }
    }
    const parsed = await response.json() as VoiceTurnResult
    if (parsed?.status === "answered" && parsed.response) {
      return { turnId, status: "answered", response: parsed.response }
    }
    return { turnId, status: parsed?.status ?? "unavailable", reason: parsed?.reason }
  } catch {
    return { turnId, status: "unavailable", reason: "gateway_unreachable" }
  }
}
