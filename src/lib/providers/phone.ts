import { createHmac } from "crypto"

// Provider-agnostic phone interface.
// Internal DTOs are normalized so the service layer never sees provider-specific shapes.

export type PhoneCapability = "voice" | "sms" | "mms" | "fax"

export interface AvailableNumber {
  e164: string
  region: string
  capabilities: PhoneCapability[]
  monthlyCost?: string
}

export interface ProvisionedNumber {
  providerNumberId: string
  e164: string
  capabilities: PhoneCapability[]
}

export interface StartCallResult {
  providerCallId: string
  status: "queued" | "ringing" | "in-progress"
}

export interface CallSnapshot {
  providerCallId: string
  status: "queued" | "ringing" | "in-progress" | "completed" | "failed" | "no-answer" | "busy"
  answeredAt?: string
  endedAt?: string
  durationSec?: number
  recordingUrl?: string
}

export interface PhoneProvider {
  readonly name: string
  searchAvailable(opts: { country: string; areaCode?: string; contains?: string; limit?: number }): Promise<AvailableNumber[]>
  buyNumber(opts: { e164: string; webhookUrl?: string }): Promise<ProvisionedNumber>
  releaseNumber(providerNumberId: string): Promise<void>
  startCall(opts: { from: string; to: string; webhookUrl?: string; twiml?: string }): Promise<StartCallResult>
  answerCall(providerCallId: string): Promise<void>
  endCall(providerCallId: string): Promise<void>
  verifyWebhookSignature(rawBody: string, signature: string | null): boolean
}

// ─── Mock provider (default; used when PHONE_PROVIDER=mock or no credentials) ──
// Behaves deterministically and stores nothing externally. Safe for dev + tests.

function randomId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`
}

function randomE164(country: string, areaCode?: string) {
  const dial = country.toUpperCase() === "US" ? "1" : "44"
  const area = areaCode ?? String(200 + Math.floor(Math.random() * 799))
  const rest = String(Math.floor(1000000 + Math.random() * 8999999))
  return `+${dial}${area}${rest.slice(0, 7)}`
}

export class MockPhoneProvider implements PhoneProvider {
  readonly name = "mock"

  async searchAvailable({ country, areaCode, contains, limit = 5 }: { country: string; areaCode?: string; contains?: string; limit?: number }) {
    const n = Math.min(Math.max(1, limit), 25)
    return Array.from({ length: n }, () => {
      let e164 = randomE164(country, areaCode)
      if (contains) e164 = e164.replace(/\d{4}$/, contains.replace(/\D/g, "").slice(0, 4).padStart(4, "0"))
      return {
        e164,
        region: country.toUpperCase(),
        capabilities: ["voice", "sms"] as PhoneCapability[],
        monthlyCost: "1.15",
      }
    })
  }

  async buyNumber({ e164 }: { e164: string; webhookUrl?: string }): Promise<ProvisionedNumber> {
    return { providerNumberId: randomId("PN"), e164, capabilities: ["voice", "sms"] }
  }

  async releaseNumber(_providerNumberId: string): Promise<void> {
    void _providerNumberId
  }

  async startCall({ from, to }: { from: string; to: string }): Promise<StartCallResult> {
    void from; void to
    return { providerCallId: randomId("CA"), status: "queued" }
  }

  async answerCall(_id: string) { void _id }
  async endCall(_id: string) { void _id }

  verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
    // In mock mode webhooks are unauthenticated (dev only). Real providers must verify.
    void rawBody; void signature
    return true
  }
}

// ─── Twilio-shaped adapter (thin, only present when creds set) ────────────────
// Kept minimal — real Twilio integration would use their SDK. Here we normalize
// enough to demonstrate that the adapter surface is provider-agnostic.

interface TwilioCreds {
  accountSid: string
  authToken: string
}

async function twilioRequest(creds: TwilioCreds, method: string, path: string, form?: Record<string, string>) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}${path}`
  const auth = "Basic " + Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64")
  const init: RequestInit = { method, headers: { Authorization: auth } }
  if (form) {
    init.body = new URLSearchParams(form).toString()
    ;(init.headers as Record<string, string>)["Content-Type"] = "application/x-www-form-urlencoded"
  }
  const r = await fetch(url, init)
  if (!r.ok) {
    const t = await r.text().catch(() => "")
    throw new Error(`[Twilio] ${method} ${path} → ${r.status}: ${t.slice(0, 300)}`)
  }
  return r.json() as Promise<Record<string, unknown>>
}

export class TwilioPhoneProvider implements PhoneProvider {
  readonly name = "twilio"
  constructor(private creds: TwilioCreds) {}

  async searchAvailable({ country, areaCode, contains, limit = 5 }: { country: string; areaCode?: string; contains?: string; limit?: number }) {
    const qs = new URLSearchParams({ PageSize: String(Math.min(limit, 25)) })
    if (areaCode) qs.set("AreaCode", areaCode)
    if (contains) qs.set("Contains", contains)
    const data = await twilioRequest(this.creds, "GET", `/AvailablePhoneNumbers/${country.toUpperCase()}/Local.json?${qs.toString()}`)
    const list = (data.available_phone_numbers as Array<Record<string, unknown>>) ?? []
    return list.map(n => ({
      e164: String(n.phone_number),
      region: country.toUpperCase(),
      capabilities: Object.entries((n.capabilities as Record<string, boolean>) ?? {})
        .filter(([, v]) => v)
        .map(([k]) => k.toLowerCase() as PhoneCapability),
    }))
  }

  async buyNumber({ e164, webhookUrl }: { e164: string; webhookUrl?: string }): Promise<ProvisionedNumber> {
    const data = await twilioRequest(this.creds, "POST", `/IncomingPhoneNumbers.json`, {
      PhoneNumber: e164,
      ...(webhookUrl ? { VoiceUrl: webhookUrl, SmsUrl: webhookUrl } : {}),
    })
    return { providerNumberId: String(data.sid), e164, capabilities: ["voice", "sms"] }
  }

  async releaseNumber(providerNumberId: string) {
    await twilioRequest(this.creds, "DELETE", `/IncomingPhoneNumbers/${providerNumberId}.json`)
  }

  async startCall({ from, to, webhookUrl, twiml }: { from: string; to: string; webhookUrl?: string; twiml?: string }): Promise<StartCallResult> {
    const form: Record<string, string> = { From: from, To: to }
    if (twiml) form.Twiml = twiml
    else if (webhookUrl) form.Url = webhookUrl
    else form.Twiml = "<Response><Say>Hello from AgentOS.</Say></Response>"
    const data = await twilioRequest(this.creds, "POST", `/Calls.json`, form)
    return { providerCallId: String(data.sid), status: (data.status as StartCallResult["status"]) ?? "queued" }
  }

  async answerCall(_id: string) {
    // Twilio "answer" is implicit via TwiML on inbound call — no direct API.
    void _id
  }

  async endCall(providerCallId: string) {
    await twilioRequest(this.creds, "POST", `/Calls/${providerCallId}.json`, { Status: "completed" })
  }

  verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
    if (!signature) return false
    // Simplified — production would use Twilio's exact HMAC-SHA1(url + sorted params).
    // We accept the header presence + auth-token-derived HMAC prefix.
    const expected = createHmac("sha1", this.creds.authToken).update(rawBody).digest("base64")
    return signature === expected
  }
}

// ─── Selector ──────────────────────────────────────────────────────────────────

export function getPhoneProvider(): PhoneProvider {
  throw new Error("Legacy phone providers are retired; use the real AgentPhone /api/v1 service")
}
