import { NextRequest, NextResponse } from "next/server"
import { requireServerSupabase } from "@/lib/supabase"
import {
  alreadyIssuedAuthentication,
  assertPaymentTenant,
  claimBootstrapTokenIssuance,
  getOrCreateTenant,
  getTenantById,
  issueAccessToken,
  requireTenant,
  type Tenant,
} from "./auth"
import { ApiError, apiData, apiError, readJson } from "./http"
import {
  beginIdempotentRequest,
  bindIdempotentPayment,
  completeIdempotentRequest,
  requestHash,
} from "./idempotency"
import { prepareV1Payment, settleV1Payment } from "./payment"
import { getServiceByEndpoint, SERVICE_CATALOG } from "./service-catalog"

export const guide = "/docs#api-contract"

function onboardingRequired(endpoint: string) {
  const requested = getServiceByEndpoint(endpoint)
  const area = requested?.area
  const startHere = SERVICE_CATALOG.find((service) =>
    service.available && service.startHere && (!area || service.area === area)
  )
  return NextResponse.json({
    error: {
      code: "ONBOARDING_REQUIRED",
      message: "Create your first AgentOS resource before using this service.",
      service: area ?? null,
      startHere: startHere ? {
        serviceId: startHere.id,
        endpoint: startHere.endpoint,
        method: startHere.method,
        price: startHere.amount,
        currency: startHere.currency,
        requiredInput: startHere.requiredInput,
      } : null,
    },
    guides: {
      llms: "/llms.txt",
      serviceCatalog: "/api/v1/services",
      openapi: "/openapi.json",
      serviceGuide: startHere?.guide ?? "/docs#start-here",
    },
    payment: {
      settled: false,
      instruction: "Do not create or submit a payment for this response.",
    },
  }, { status: 428 })
}

function preflightCatalogInput(endpoint: string, body: Record<string, unknown>) {
  const service = getServiceByEndpoint(endpoint)
  if (!service) return
  for (const field of Object.keys(service.requiredInput)) {
    const value = body[field]
    if (
      value === undefined
      || value === null
      || (typeof value === "string" && !value.trim())
      || (Array.isArray(value) && value.length === 0)
    ) {
      throw new ApiError("INVALID_REQUEST", `${field} is required`, 400)
    }
  }
  // Customer Agents no longer expose a public webhook. Reject the retired field
  // explicitly so an Agent built against the old contract gets a clear error
  // instead of silently having its callback ignored.
  if ("agentWebhookUrl" in body) {
    throw new ApiError(
      "INVALID_REQUEST",
      "agentWebhookUrl is no longer accepted. Live calls are answered over the AgentOS WebSocket; see /docs#live-voice-protocol",
      400,
    )
  }
  if (
    "toNumber" in body
    && (typeof body.toNumber !== "string" || !/^\+[1-9]\d{6,14}$/.test(body.toNumber))
  ) {
    throw new ApiError("INVALID_REQUEST", "toNumber must be an E.164 phone number", 400)
  }
  if (
    "areaCode" in body
    && body.areaCode !== undefined
    && (typeof body.areaCode !== "string" || !/^\d{3}$/.test(body.areaCode))
  ) {
    throw new ApiError("INVALID_REQUEST", "areaCode must contain exactly three digits", 400)
  }
}

async function preflightOwnedResource(
  tenant: Tenant,
  endpoint: string,
  body: Record<string, unknown>,
) {
  const service = getServiceByEndpoint(endpoint)
  if (!service || service.startHere) return
  const candidates = [
    { field: "mailboxId", table: "v1_mailboxes" },
    { field: "phoneNumberId", table: "v1_phone_numbers" },
    { field: "callId", table: "v1_calls" },
  ] as const
  const candidate = candidates.find(({ field }) => field in service.requiredInput)
  if (!candidate) return
  const resourceId = body[candidate.field]
  if (typeof resourceId !== "string" || !resourceId.trim()) {
    throw new ApiError("INVALID_REQUEST", `${candidate.field} is required`, 400)
  }
  const { data, error } = await requireServerSupabase()
    .from(candidate.table)
    .select("id")
    .eq("id", resourceId)
    .eq("tenant_id", tenant.id)
    .maybeSingle()
  if (error) throw new ApiError("PROVIDER_CONFIGURATION_ERROR", "Resource validation is unavailable", 503)
  if (!data) {
    throw new ApiError(
      "RESOURCE_NOT_OWNED",
      "The requested resource does not exist or is not owned by this access token",
      404,
    )
  }
}

function attachBootstrapToken(body: unknown, token: { token: string; expiresAt: string | null }, tenant: Tenant) {
  const authentication = {
    accessToken: token.token,
    expiresAt: token.expiresAt,
    walletAddress: tenant.walletAddress,
    warning: "Store this token securely; it is shown only once.",
  }
  if (body && typeof body === "object" && !Array.isArray(body)) {
    return { ...(body as Record<string, unknown>), authentication }
  }
  return { result: body, authentication }
}

/**
 * Replay of a completed bootstrap request. The stored business response is
 * returned unchanged, with an explicit note that authentication was already
 * issued. No new token is minted and no fabricated replacement is returned.
 */
function attachAlreadyIssuedNotice(body: unknown, tenant: Tenant) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body
  const response = body as Record<string, unknown>
  const data = response.data
  const authentication = alreadyIssuedAuthentication(tenant)
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return { ...response, data: { ...(data as Record<string, unknown>), authentication } }
  }
  return { ...response, authentication }
}

export async function v1Read(request: NextRequest, handler: (tenant: Tenant) => Promise<unknown>) {
  try {
    return apiData(await handler(await requireTenant(request)), guide)
  } catch (error) {
    return apiError(error, guide)
  }
}

export async function v1Write(
  request: NextRequest,
  handler: (tenant: Tenant, body: Record<string, unknown>) => Promise<{ status?: number; body: unknown }>,
) {
  try {
    const tenant = await requireTenant(request)
    const body = await readJson(request)
    const result = await handler(tenant, body)
    return apiData(result.body, guide, result.status ?? 200)
  } catch (error) {
    return apiError(error, guide)
  }
}

export async function v1Action(
  request: NextRequest,
  handler: (tenant: Tenant) => Promise<{ status?: number; body: unknown }>,
) {
  try {
    const result = await handler(await requireTenant(request))
    return apiData(result.body, guide, result.status ?? 200)
  } catch (error) {
    return apiError(error, guide)
  }
}

export async function v1Paid(
  request: NextRequest,
  endpoint: string,
  price: string,
  description: string,
  handler: (tenant: Tenant, body: Record<string, unknown>) => Promise<{ status?: number; body: unknown }>,
) {
  try {
    const bearer = request.headers.get("authorization")
    const service = getServiceByEndpoint(endpoint)
    if (!service?.paid || service.x402Price !== price) {
      throw new ApiError(
        "PAYMENT_CONFIGURATION_ERROR",
        "Route price does not match the canonical AgentOS service catalog",
        503,
      )
    }
    const startHere = service?.startHere === true
    if (!bearer && !startHere) return onboardingRequired(endpoint)
    const body = await readJson(request)
    preflightCatalogInput(endpoint, body)
    const bootstrap = !bearer && startHere
    const existingTenant = bootstrap ? null : await requireTenant(request)
    if (existingTenant) await preflightOwnedResource(existingTenant, endpoint, body)
    const payment = await prepareV1Payment(request, endpoint, price, description, body)
    if (payment.kind === "blocked") return payment.response

    const idempotencyKey = request.headers.get("idempotency-key")?.trim()
    if (!idempotencyKey) {
      throw new ApiError("idempotency_required", "Idempotency-Key is required for paid requests")
    }
    const bodyHash = requestHash(body)

    let tenant: Tenant
    if (payment.kind === "settled") {
      if (
        payment.endpoint !== endpoint
        || payment.idempotencyKey !== idempotencyKey
        || payment.requestHash !== bodyHash
      ) {
        throw new ApiError(
          "payment_replay_conflict",
          "This payment proof is already bound to a different request",
          409,
        )
      }
      tenant = existingTenant ?? await getTenantById(payment.tenantId)
      if (existingTenant) assertPaymentTenant(existingTenant, payment.payer)
    } else {
      tenant = existingTenant ?? await getOrCreateTenant(payment.payer)
      if (existingTenant) assertPaymentTenant(existingTenant, payment.payer)
    }

    const state = await beginIdempotentRequest(tenant.id, endpoint, idempotencyKey, bodyHash)
    if (state.kind === "conflict") {
      throw new ApiError(
        "idempotency_conflict",
        "Idempotency-Key was already used with a different request",
        409,
      )
    }
    if (state.kind === "replay") {
      // A completed replay never repeats the provider operation and never issues
      // another permanent credential.
      const replaySettlement = state.settlementHeader
        ?? (payment.kind === "settled" ? payment.settlementHeader : "")
      return NextResponse.json(
        bootstrap ? attachAlreadyIssuedNotice(state.body, tenant) : state.body,
        {
          status: state.status,
          headers: {
            ...(replaySettlement ? { "PAYMENT-RESPONSE": replaySettlement } : {}),
            "x-idempotent-replay": "true",
          },
        },
      )
    }
    if (
      state.kind === "in_progress"
      && state.paymentPayloadHash
      && state.paymentPayloadHash !== payment.paymentPayloadHash
    ) {
      throw new ApiError(
        "idempotency_payment_conflict",
        "This Idempotency-Key is associated with another payment proof",
        409,
      )
    }
    if (state.kind === "in_progress") {
      throw new ApiError(
        "idempotency_in_progress",
        "A matching paid operation is still in progress; retry the same request",
        409,
      )
    }

    const settlement = payment.kind === "settled"
      ? payment
      : await settleV1Payment({
          payment,
          tenant,
          endpoint,
          idempotencyKey,
          requestHash: bodyHash,
        })

    await bindIdempotentPayment(
      tenant.id,
      endpoint,
      idempotencyKey,
      settlement.paymentPayloadHash,
      settlement.settlementHeader,
    )

    let result: { status?: number; body: unknown }
    try {
      result = await handler(tenant, body)
    } catch (handlerError) {
      const failedResponse = apiError(handlerError, guide)
      await completeIdempotentRequest(
        tenant.id,
        endpoint,
        idempotencyKey,
        failedResponse.status,
        await failedResponse.clone().json(),
        settlement.paymentPayloadHash,
        settlement.settlementHeader,
      )
      failedResponse.headers.set("PAYMENT-RESPONSE", settlement.settlementHeader)
      return failedResponse
    }
    const storedResponse = apiData(result.body, guide, result.status ?? 200)
    await completeIdempotentRequest(
      tenant.id,
      endpoint,
      idempotencyKey,
      storedResponse.status,
      await storedResponse.clone().json(),
      settlement.paymentPayloadHash,
      settlement.settlementHeader,
    )
    // Issue the permanent token only on the first successful paid provisioning
    // for this wallet, and only if this request wins the atomic claim.
    const token = bootstrap && await claimBootstrapTokenIssuance(tenant.id)
      ? await issueAccessToken(tenant.id)
      : null
    const response = token
      ? apiData(attachBootstrapToken(result.body, token, tenant), guide, result.status ?? 200)
      : bootstrap
        ? apiData(
            { ...(result.body as Record<string, unknown>), authentication: alreadyIssuedAuthentication(tenant) },
            guide,
            result.status ?? 200,
          )
        : storedResponse
    response.headers.set("PAYMENT-RESPONSE", settlement.settlementHeader)
    return response
  } catch (error) {
    return apiError(error, guide)
  }
}
