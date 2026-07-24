import { createHash } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { x402ResourceServer } from "@okxweb3/x402-core/server"
import { OKXFacilitatorClient } from "@okxweb3/x402-core"
import { ExactEvmScheme } from "@okxweb3/x402-evm/exact/server"
import type { PaymentPayload, PaymentRequirements } from "@okxweb3/x402-core/types"
import { requireServerSupabase } from "@/lib/supabase"
import type { Tenant } from "./auth"
import { appUrl, isSafeProductionUrl, requireProductionConfig } from "./config"
import { ApiError } from "./http"
import { createDurableEvent } from "./events"
import { getServiceByEndpoint } from "./service-catalog"

type InputSchema = {
  type: "http"
  method: "POST"
  bodyType: "json"
  body: unknown
}

type PaymentServer = InstanceType<typeof x402ResourceServer>
type Blocked = { kind: "blocked"; response: NextResponse }
export type VerifiedPayment = {
  kind: "verified"
  server: PaymentServer
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
  idempotencyKey: string | null
  requestHash: string | null
}

let initialized: Promise<PaymentServer> | null = null

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
      await server.initialize()
      return server
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

export async function prepareV1Payment(
  request: NextRequest,
  path: string,
  price: string,
  description: string,
  body: unknown
): Promise<Blocked | VerifiedPayment | PreviouslySettledPayment> {
  let server: PaymentServer
  try {
    server = await paymentServer()
  } catch {
    return paymentError("PAYMENT_CONFIGURATION_ERROR", "Payment service is unavailable", 503)
  }

  const requirements = await server.buildPaymentRequirementsFromOptions([
    { scheme: "exact", network: "eip155:196", payTo: process.env.PAYMENT_WALLET!, price },
  ], null)
  const input: InputSchema = { type: "http", method: "POST", bodyType: "json", body }
  const enriched = requirements.map((requirement) => ({
    ...requirement,
    extra: { ...(requirement.extra ?? {}), outputSchema: { input } },
  }))
  const resource = { url: `${appUrl()}${path}`, description, mimeType: "application/json" }
  const decoded = decodePayment(request)

  if (!decoded) {
    const required = await server.createPaymentRequiredResponse(enriched, resource, "Payment required")
    const service = getServiceByEndpoint(path)
    return {
      kind: "blocked",
      response: NextResponse.json({
        ...required,
        agentos: {
          serviceId: service?.id ?? null,
          fixedPrice: service ? { amount: service.amount, currency: service.currency } : null,
          startHere: service?.startHere ?? false,
          guides: {
            docs: service?.guide ?? "/docs#authentication-and-okx-x402",
            llms: "/llms.txt",
            serviceCatalog: "/api/v1/services",
            openapi: "/openapi.json",
          },
        },
      }, {
        status: 402,
        headers: { "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(required)).toString("base64") },
      }),
    }
  }

  const db = requireServerSupabase()
  const { data: existing, error: existingError } = await db
    .from("v1_payments")
    .select("tenant_id,payer_wallet,payment_payload_hash,settlement_header,endpoint,idempotency_key,request_hash")
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
      idempotencyKey: existing.idempotency_key,
      requestHash: existing.request_hash,
    }
  }

  const matched = server.findMatchingRequirements(enriched, decoded.payload)
  if (!matched) return paymentError("INVALID_PAYMENT", "Payment does not match this request")
  try {
    const verification = await server.verifyPayment(decoded.payload, matched)
    if (!verification.isValid || !verification.payer) {
      return paymentError("INVALID_PAYMENT", "Payment verification failed")
    }
    return {
      kind: "verified",
      server,
      payload: decoded.payload,
      matched,
      payer: verification.payer,
      paymentPayloadHash: decoded.hash,
      price,
    }
  } catch {
    return paymentError("INVALID_PAYMENT", "Payment verification failed")
  }
}

export async function settleV1Payment(input: {
  payment: VerifiedPayment
  tenant: Tenant
  endpoint: string
  idempotencyKey: string
  requestHash: string
}) {
  const serviceId = getServiceByEndpoint(input.endpoint)?.id ?? input.endpoint
  let settlement: Awaited<ReturnType<PaymentServer["settlePayment"]>>
  try {
    settlement = await input.payment.server.settlePayment(input.payment.payload, input.payment.matched)
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
  if (!settlement.success || (settlement.status && settlement.status !== "success")) {
    throw new ApiError("payment_settlement_failed", "Payment did not settle", 502)
  }
  const settlementHeader = Buffer.from(JSON.stringify(settlement)).toString("base64")
  const db = requireServerSupabase()
  const { error } = await db.from("v1_payments").insert({
    tenant_id: input.tenant.id,
    endpoint: input.endpoint,
    service_id: serviceId,
    payer_wallet: input.tenant.walletAddress,
    payment_payload_hash: input.payment.paymentPayloadHash,
    idempotency_key: input.idempotencyKey,
    request_hash: input.requestHash,
    settlement,
    settlement_header: settlementHeader,
    amount: input.payment.price.replace(/^\$/, ""),
    currency: "USDT",
  })
  if (error?.code === "23505") {
    const { data: existing } = await db.from("v1_payments")
      .select("tenant_id,endpoint,idempotency_key,request_hash,settlement_header")
      .eq("payment_payload_hash", input.payment.paymentPayloadHash)
      .maybeSingle()
    if (
      !existing
      || existing.tenant_id !== input.tenant.id
      || existing.endpoint !== input.endpoint
      || existing.idempotency_key !== input.idempotencyKey
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
