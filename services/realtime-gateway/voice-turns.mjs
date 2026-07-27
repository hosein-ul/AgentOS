// Live-voice turn correlation for the AgentOS realtime gateway.
//
// This is deliberately separate from the durable event inbox. A durable event is
// stored, replayed and acknowledged; a voice turn is a synchronous request that
// AgentPhone is holding a phone call open for. A turn is never persisted, never
// replayed, and always resolves within its deadline.
//
// The module is pure so it can be unit tested without a socket server: it owns
// correlation, tenant isolation, duplicate suppression and expiry, and calls back
// into whatever transport the caller supplies.

export const VOICE_PROTOCOL_VERSION = 1

export const VOICE_TURN_MESSAGE = "voice.turn"
export const VOICE_RESPONSE_MESSAGE = "voice.response"
export const VOICE_CANCEL_MESSAGE = "voice.cancel"
export const VOICE_TIMEOUT_MESSAGE = "voice.timeout"

export const VOICE_MAX_TEXT_LENGTH = 2_000
export const VOICE_MIN_TURN_MS = 1_000
export const VOICE_DEFAULT_TURN_MS = 8_000
export const VOICE_MAX_TURN_MS = 20_000
export const VOICE_MAX_PENDING_TURNS = 500

const VOICE_RESPONSE_FIELDS = ["text", "hangup", "action", "digits"]

export function clampTurnDeadline(value) {
  const requested = Number(value)
  if (!Number.isFinite(requested)) return VOICE_DEFAULT_TURN_MS
  return Math.min(VOICE_MAX_TURN_MS, Math.max(VOICE_MIN_TURN_MS, Math.floor(requested)))
}

/**
 * Reduce an agent reply to the small allowlisted shape AgentPhone accepts.
 * Returns null when the reply carries no usable voice action, so that an
 * invalid answer is treated as no answer rather than being forwarded blindly.
 */
export function normalizeVoiceResponse(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) return null
  const response = {}
  for (const field of VOICE_RESPONSE_FIELDS) {
    if (!(field in message)) continue
    const value = message[field]
    if (field === "text") {
      if (typeof value !== "string") return null
      const text = value.trim()
      if (!text || text.length > VOICE_MAX_TEXT_LENGTH) return null
      response.text = text
    } else if (field === "hangup") {
      if (typeof value !== "boolean") return null
      response.hangup = value
    } else if (field === "action") {
      if (value !== "hangup" && value !== "continue") return null
      response.action = value
    } else if (field === "digits") {
      if (typeof value !== "string" || !/^[0-9*#]{1,32}$/.test(value)) return null
      response.digits = value
    }
  }
  const hangs = response.hangup === true || response.action === "hangup"
  if (typeof response.text !== "string" && !hangs) return null
  return response
}

export class VoiceTurnRegistry {
  #pending = new Map()
  #maxPending
  #now
  #setTimer
  #clearTimer

  constructor(options = {}) {
    this.#maxPending = options.maxPending ?? VOICE_MAX_PENDING_TURNS
    this.#now = options.now ?? (() => Date.now())
    this.#setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.#clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle))
  }

  get size() {
    return this.#pending.size
  }

  has(turnId) {
    return this.#pending.has(turnId)
  }

  /**
   * Register a turn and return a promise that always settles: with the agent's
   * answer, or with a terminal reason. The caller is responsible for turning a
   * non-answered result into a safe fallback for AgentPhone.
   */
  open(input) {
    const { turnId, tenantId, socket, send, deadlineMs } = input
    if (typeof turnId !== "string" || !turnId) {
      return Promise.resolve({ status: "invalid", reason: "turn_id_required" })
    }
    if (this.#pending.has(turnId)) {
      return Promise.resolve({ status: "invalid", reason: "duplicate_turn" })
    }
    if (this.#pending.size >= this.#maxPending) {
      // Bounded state: shed load rather than accumulate unresolved turns.
      return Promise.resolve({ status: "overloaded", reason: "too_many_pending_turns" })
    }

    const timeoutMs = clampTurnDeadline(deadlineMs)
    const deadline = new Date(this.#now() + timeoutMs).toISOString()

    return new Promise((resolve) => {
      const settle = (result) => {
        const entry = this.#pending.get(turnId)
        if (!entry) return
        this.#clearTimer(entry.timer)
        this.#pending.delete(turnId)
        resolve(result)
      }

      const timer = this.#setTimer(() => {
        send(socket, {
          type: VOICE_TIMEOUT_MESSAGE,
          turnId,
          reason: "deadline_exceeded",
          deadline,
        })
        settle({ status: "timeout", reason: "deadline_exceeded" })
      }, timeoutMs)

      this.#pending.set(turnId, { turnId, tenantId, socket, settle, timer })

      send(socket, {
        type: VOICE_TURN_MESSAGE,
        protocolVersion: VOICE_PROTOCOL_VERSION,
        turnId,
        tenantScoped: true,
        callId: input.callId ?? null,
        phoneNumberId: input.phoneNumberId ?? null,
        providerCallId: input.providerCallId ?? null,
        direction: input.direction ?? null,
        fromNumber: input.fromNumber ?? null,
        toNumber: input.toNumber ?? null,
        transcript: input.transcript ?? null,
        event: input.event ?? null,
        deadline,
        deadlineMs: timeoutMs,
        respondWith: {
          type: VOICE_RESPONSE_MESSAGE,
          turnId,
          text: "<what the caller should hear>",
          hangup: false,
        },
      })
    })
  }

  /**
   * Apply an inbound voice.response. Rejects turns that belong to another
   * tenant or another socket's tenant, unknown turn IDs, replies to already
   * answered turns, and replies that carry no valid voice action.
   */
  resolve(socket, message) {
    const turnId = message?.turnId
    if (typeof turnId !== "string" || !turnId) {
      return { ok: false, reason: "turn_id_required" }
    }
    const entry = this.#pending.get(turnId)
    if (!entry) {
      // Already answered, timed out, or never existed. Never leaks whether the
      // turn belongs to another tenant.
      return { ok: false, reason: "unknown_turn" }
    }
    if (!socket || socket.tenantId !== entry.tenantId) {
      return { ok: false, reason: "wrong_tenant" }
    }
    const response = normalizeVoiceResponse(message)
    if (!response) {
      return { ok: false, reason: "invalid_response" }
    }
    entry.settle({ status: "answered", response })
    return { ok: true, turnId }
  }

  /** The agent explicitly declines this turn; AgentPhone gets the fallback. */
  cancel(socket, message) {
    const turnId = message?.turnId
    if (typeof turnId !== "string" || !turnId) return { ok: false, reason: "turn_id_required" }
    const entry = this.#pending.get(turnId)
    if (!entry) return { ok: false, reason: "unknown_turn" }
    if (!socket || socket.tenantId !== entry.tenantId) return { ok: false, reason: "wrong_tenant" }
    entry.settle({ status: "canceled", reason: "agent_canceled" })
    return { ok: true, turnId }
  }

  /** Settle every turn waiting on a socket that just went away. */
  failSocket(socket) {
    let failed = 0
    for (const entry of [...this.#pending.values()]) {
      if (entry.socket !== socket) continue
      entry.settle({ status: "disconnected", reason: "agent_socket_closed" })
      failed += 1
    }
    return failed
  }
}
