import { createHash } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { x402ResourceServer, x402HTTPResourceServer } from "@okxweb3/x402-core/server"
import { OKXFacilitatorClient } from "@okxweb3/x402-core"
import { ExactEvmScheme } from "@okxweb3/x402-evm/exact/server"
import type { PaymentPayload, PaymentRequirements } from "@okxweb3/x402-core/types"
import type { RoutesConfig } from "@okxweb3/x402-core/server"
import { requireServerSupabase } from "@/lib/supabase"
import type { Tenant } from "./auth"
import { appUrl, isSafeProductionUrl, requireProductionConfig } from "./config"
import { ApiError } from "./http"
import { createDurableEvent } from "./events"
import { getServiceByEndpoint, SERVICE_CATALOG, type ServiceCatalogEntry } from "./service-catalog"
import { NextRequestAdapter } from "./okx-adapter"

type JsonSchemaProperty = {
  type: "string" | "boolean" | "integer" | "array"
  description: string
  items?: { type: "string" }
}

type BodyJsonSchema = {
  type: "object"
  properties: Record<string, JsonSchemaProperty>
  required: string[]
}

type InputSchema = {
  type: "http"
  method: "POST"
  bodyType: "json"
  body: BodyJsonSchema
}

/**
 * Infer a JSON Schema property from a catalog field description. The catalog
 * stores human descriptions rather than types, and these keywords are the
 * consistent markers it uses for the non-string fields.
 */
function schemaProperty(description: string): JsonSchemaProperty {
  if (/array/i.test(description)) return { type: "array", description, items: { type: "string" } }
  if (/^boolean\b/i.test(description) || /^must be (true|false)$/i.test(description)) {
    return { type: "boolean", description }
  }
  if (/^\d+-\d+$/.test(description.trim())) return { type: "integer", description }
  return { type: "string", description }
}

/**
 * The x402 `outputSchema.input.body` must be a JSON Schema describing the
 * parameters the paid replay has to carry — the buyer's client reads
 * `properties` / `required` to build that replay body.
 */
function bodySchemaForService(service: ServiceCatalogEntry): BodyJsonSchema {
  const properties: Record<string, JsonSchemaProperty> = {}
  for (const [field, description] of Object.entries(service.requiredInput ?? {})) {
    properties[field] = schemaProperty(description)
  }
  for (const [field, description] of Object.entries(service.optionalInput ?? {})) {
    properties[field] = schemaProperty(description)
  }
  return {
    type: "object",
    properties,
    required: Object.keys(service.requiredInput ?? {}),
  }
}

function bodySchema(path: string): BodyJsonSchema {
  const service = getServiceByEndpoint(path)
  if (!service) return { type: "object", properties: {}, required: [] }
  return bodySchemaForService(service)
}

type PaymentServer = InstanceType<typeof x402ResourceServer>
type HTTPServer = InstanceType<typeof x402HTTPResourceServer>
type Blocked = { kind: "blocked"; response: NextResponse }
export type VerifiedPayment = {
  kind: "verified"
  server: PaymentServer
  http: HTTPServer
  payload: PaymentPayload
  matched: PaymentRequirements
  payer: string
  paymentPayloadHash: string
  price: string
}
export type PreviouslySettledPayment = {
  kind: "settled"
  tenantId: string
  payer: string
  paymentPayloadHash: string
  settlementHeader: string
  endpoint: string | null
  requestHash: string | null
  responseStatus: number | null
  responseBody: unknown
}

export function requestHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

/**
 * Build the official-SDK route table from the AgentOS service catalog. Each
 * paid endpoint is registered under both GET and POST so `x402HTTPResourceServer`
 * answers a discovery probe (GET) with the same 402 challenge as the real
 * payment call (POST) — buyer-agent clients probe GET first.
 */
function buildRoutes(): RoutesConfig {
  const routes: Record<string, {
    accepts: Array<{ scheme: string; network: string; payTo: string; price: string; extra?: Record<string, unknown> }>
    description: string
    mimeType: string
    resource: string
  }> = {}
  for (const service of SERVICE_CATALOG) {
    if (!service.paid || !service.x402Price) continue
    const path = service.endpoint
    const accepts = [{
      scheme: "exact",
      network: "eip155:196",
      payTo: process.env.PAYMENT_WALLET!,
      price: service.x402Price,
      extra: {
        outputSchema: {
          input: { type: "http", method: "POST", bodyType: "json", body: bodySchemaForService(service) } as InputSchema,
        },
      },
    }]
    const config = {
      accepts,
      description: service.description,
      mimeType: "application/json",
      resource: `${appUrl()}${path}`,
    }
    routes[`GET ${path}`] = config
    routes[`POST ${path}`] = config
  }
  return routes as unknown as RoutesConfig
}

let initialized: Promise<{ server: PaymentServer; http: HTTPServer }> | null = null

async function paymentServer() {
  if (!initialized) {
    const apiKey = process.env.OKX_API_KEY
    const secretKey = process.env.OKX_SECRET_KEY
    const passphrase = process.env.OKX_PASSPHRASE
    const paymentWallet = process.env.PAYMENT_WALLET
    try {
      requireProductionConfig()
    } catch {
      throw new Error("Payment configuration is incomplete")
    }
    if (!apiKey || !secretKey || !passphrase || !paymentWallet || !isSafeProductionUrl(appUrl())) {
      throw new Error("Payment configuration is incomplete")
    }
    initialized = (async () => {
      const facilitator = new OKXFacilitatorClient({ apiKey, secretKey, passphrase })
      const server = new x402ResourceServer(facilitator)
      server.register("eip155:196", new ExactEvmScheme())
      const http = new x402HTTPResourceServer(server, buildRoutes())
      await http.initialize()
      return { server, http }
    })()
  }
  return initialized
}

function decodePayment(request: NextRequest) {
  const encoded = request.headers.get("payment-signature")
  if (!encoded) return null
  try {
    return {
      encoded,
      payload: JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as PaymentPayload,
      hash: createHash("sha256").update(encoded).digest("hex"),
    }
  } catch {
    return null
  }
}

function paymentError(code: string, message: string, status = 402) {
  return {
    kind: "blocked" as const,
    response: NextResponse.json({
      error: { code, message },
      guides: {
        docs: "/docs#authentication-and-okx-x402",
        llms: "/llms.txt",
        serviceCatalog: "/api/v1/services",
        openapi: "/openapi.json",
      },
    }, { status }),
  }
}

function paymentUnavailable(error: unknown): Blocked {
  const message = error instanceof Error && error.message.includes("PAYMENT_WALLET")
    ? "Payment service is unavailable because its receiving wallet is invalid. Contact the AgentOS operator."
    : "Payment service is unavailable"
  return paymentError("PAYMENT_CONFIGURATION_ERROR", message, 503)
}

function agentosBlock(path: string) {
  const service = getServiceByEndpoint(path)
  return {
    serviceId: service?.id ?? null,
    fixedPrice: service ? { amount: service.amount, currency: service.currency } : null,
    startHere: service?.startHere ?? false,
    requiresAccessToken: service ? !service.startHere : false,
    accessTokenNote: service?.startHere
      ? "Callable without a bearer token. The first successful paid provisioning for a wallet returns the permanent AgentOS access token exactly once."
      : "Send the AgentOS access token as a bearer token. Obtain it from the first paid provisioning call.",
    guides: {
      docs: service?.guide ?? "/docs#authentication-and-okx-x402",
      llms: "/llms.txt",
      serviceCatalog: "/api/v1/services",
      openapi: "/openapi.json",
    },
  }
}

/**
 * Build a NextResponse from the SDK's ProcessResult, adding the AgentOS
 * `agentos` metadata block into the JSON body. The SDK response is the
 * source of truth for status, PAYMENT-REQUIRED and content-type — we
 * only enrich the JSON body.
 */
function sdkResponse(result: { status: number; headers: Record<string, string>; body?: unknown; isHtml?: boolean }, path: string): NextResponse {
  if (result.isHtml || result.headers["Content-Type"] === "text/html") {
    return new NextResponse(String(result.body), { status: result.status, headers: result.headers })
  }
  const body = (result.body && typeof result.body === "object" && !Array.isArray(result.body))
    ? { ...(result.body as Record<string, unknown>), agentos: agentosBlock(path) }
    : { body: result.body, agentos: agentosBlock(path) }
  return NextResponse.json(body, { status: result.status, headers: result.headers })
}

/**
 * The x402 discovery challenge for an unpaid request, produced by the
 * official OKX `x402HTTPResourceServer`. It answers a GET or POST probe on
 * a registered paid endpoint with the SDK-built 402 payload — including
 * `PAYMENT-REQUIRED` header, `accepts[]`, and the `outputSchema` JSON
 * Schema — and appends the AgentOS metadata block.
 */
export async function v1PaymentChallenge(
  path: string,
  _price: string,
  _description: string,
  method: "GET" | "POST" = "POST",
): Promise<Blocked> {
  let http: HTTPServer
  try {
    ({ http } = await paymentServer())
  } catch (error) {
    return paymentUnavailable(error)
  }
  const stubUrl = `${appUrl()}${path}`
  const stubRequest = new Request(stubUrl, { method, headers: { accept: "application/json" } }) as unknown as NextRequest
  const context = {
    adapter: new NextRequestAdapter(stubRequest, path),
    path,
    method,
    paymentHeader: undefined,
  }
  const result = await http.processHTTPRequest(context)
  if (result.type === "payment-error") {
    return { kind: "blocked", response: sdkResponse(result.response, path) }
  }
  // A registered paid route must always answer an unpaid probe with 402.
  return paymentError("PAYMENT_CONFIGURATION_ERROR", "Payment challenge unavailable", 503)
}

export async function prepareV1Payment(
  request: NextRequest,
  path: string,
  price: string,
  description: string,
): Promise<Blocked | VerifiedPayment | PreviouslySettledPayment> {
  let server: PaymentServer
  let http: HTTPServer
  try {
    ({ server, http } = await paymentServer())
  } catch (error) {
    return paymentUnavailable(error)
  }
  const decoded = decodePayment(request)
  if (!decoded) return v1PaymentChallenge(path, price, description, request.method === "GET" ? "GET" : "POST")

  // Replay ledger — the SDK verifies signatures but does not track prior use.
  const db = requireServerSupabase()
  const { data: existing, error: existingError } = await db
    .from("v1_payments")
    .select("tenant_id,payer_wallet,payment_payload_hash,settlement_header,endpoint,request_hash,response_status,response_body")
    .eq("payment_payload_hash", decoded.hash)
    .maybeSingle()
  if (existingError) return paymentError("PAYMENT_CONFIGURATION_ERROR", "Payment ledger is unavailable", 503)
  if (existing) {
    return {
      kind: "settled",
      tenantId: existing.tenant_id,
      payer: existing.payer_wallet,
      paymentPayloadHash: existing.payment_payload_hash,
      settlementHeader: existing.settlement_header,
      endpoint: existing.endpoint,
      requestHash: existing.request_hash,
      responseStatus: existing.response_status,
      responseBody: existing.response_body,
    }
  }

  // Verify through the SDK's HTTP-layer entry point — same code path the
  // Express middleware uses. Route matching, requirements building,
  // requirements matching and signature verification all live here.
  const context = {
    adapter: new NextRequestAdapter(request, path),
    path,
    method: "POST",
    paymentHeader: request.headers.get("payment-signature") ?? undefined,
  }
  const result = await http.processHTTPRequest(context)
  if (result.type === "payment-error") {
    return { kind: "blocked", response: sdkResponse(result.response, path) }
  }
  if (result.type !== "payment-verified") {
    return paymentError("INVALID_PAYMENT", "Payment verification failed")
  }
  const verification = await server.verifyPayment(result.paymentPayload, result.paymentRequirements)
  if (!verification.payer) return paymentError("INVALID_PAYMENT", "Payment verification failed")
  return {
    kind: "verified",
    server,
    http,
    payload: result.paymentPayload,
    matched: result.paymentRequirements,
    payer: verification.payer,
    paymentPayloadHash: decoded.hash,
    price,
  }
}

export async function settleV1Payment(input: {
  payment: VerifiedPayment
  tenant: Tenant
  endpoint: string
  requestHash: string
}) {
  const serviceId = getServiceByEndpoint(input.endpoint)?.id ?? input.endpoint
  // Settle through the SDK's HTTP layer — same processSettlement the Express
  // middleware calls. `responseBody` is the merchant response we're about to
  // return; the SDK reserves it for extension use (partial settlement etc.)
  // and it does not affect the on-chain settle for the exact scheme.
  let settleResult: Awaited<ReturnType<HTTPServer["processSettlement"]>>
  try {
    settleResult = await input.payment.http.processSettlement(
      input.payment.payload,
      input.payment.matched,
      undefined,
      { request: { adapter: null as never, path: input.endpoint, method: "POST" }, responseBody: Buffer.alloc(0), responseHeaders: {} },
    )
  } catch {
    await createDurableEvent({
      tenantId: input.tenant.id,
      eventKey: `payment:${input.payment.paymentPayloadHash}:failed`,
      type: "payment.failed",
      service: "billing",
      resourceType: "payment",
      resourceId: input.payment.paymentPayloadHash,
      payload: {
        endpoint: input.endpoint,
        serviceId,
        amount: input.payment.price.replace(/^\$/, ""),
        currency: "USDT",
        retryable: true,
        source: "agentos.internal",
      },
    }).catch(() => undefined)
    throw new ApiError("payment_settlement_failed", "Payment processing failed", 502)
  }
  if (!settleResult.success) {
    throw new ApiError("payment_settlement_failed", "Payment did not settle", 502)
  }
  const settlementHeader = settleResult.headers["PAYMENT-RESPONSE"]
  if (!settlementHeader) {
    throw new ApiError("payment_settlement_failed", "Settlement header missing", 502)
  }
  const db = requireServerSupabase()
  const { error } = await db.from("v1_payments").insert({
    tenant_id: input.tenant.id,
    endpoint: input.endpoint,
    service_id: serviceId,
    payer_wallet: input.tenant.walletAddress,
    payment_payload_hash: input.payment.paymentPayloadHash,
    request_hash: input.requestHash,
    settlement: settleResult,
    settlement_header: settlementHeader,
    amount: input.payment.price.replace(/^\$/, ""),
    currency: "USDT",
  })
  if (error?.code === "23505") {
    const { data: existing } = await db.from("v1_payments")
      .select("tenant_id,endpoint,request_hash,settlement_header")
      .eq("payment_payload_hash", input.payment.paymentPayloadHash)
      .maybeSingle()
    if (
      !existing
      || existing.tenant_id !== input.tenant.id
      || existing.endpoint !== input.endpoint
      || existing.request_hash !== input.requestHash
    ) {
      throw new ApiError("payment_replay_conflict", "Payment proof was already used for another operation", 409)
    }
    return { settlementHeader: existing.settlement_header, paymentPayloadHash: input.payment.paymentPayloadHash }
  }
  if (error) throw new ApiError("payment_ledger_error", "Payment settled but could not be recorded; contact support before retrying", 503)
  await createDurableEvent({
    tenantId: input.tenant.id,
    eventKey: `payment:${input.payment.paymentPayloadHash}:completed`,
    type: "payment.completed",
    service: "billing",
    resourceType: "payment",
    resourceId: input.payment.paymentPayloadHash,
    payload: {
      endpoint: input.endpoint,
      serviceId,
      amount: input.payment.price.replace(/^\$/, ""),
      currency: "USDT",
      completedAt: new Date().toISOString(),
      source: "agentos.internal",
    },
  })
  return { settlementHeader, paymentPayloadHash: input.payment.paymentPayloadHash }
}

export async function recordPaidResponse(
  paymentPayloadHash: string,
  status: number,
  body: unknown,
) {
  const { error } = await requireServerSupabase()
    .from("v1_payments")
    .update({
      response_status: status,
      response_body: body,
      completed_at: new Date().toISOString(),
    })
    .eq("payment_payload_hash", paymentPayloadHash)
  if (error) {
    throw new ApiError(
      "payment_ledger_error",
      "The operation completed but its result could not be recorded; contact support before retrying",
      503,
    )
  }
}

// Re-export the schema helper for tests that verify it did not regress.
export { bodySchema }
