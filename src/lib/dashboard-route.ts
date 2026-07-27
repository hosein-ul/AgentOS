import "server-only"

import { NextRequest, NextResponse } from "next/server"
import { getDashboardSession, setDashboardSession } from "@/lib/dashboard-auth"
import {
  getOrCreateTenant,
  getTenantById,
  type Tenant,
} from "@/lib/v1/auth"
import {
  beginIdempotentRequest,
  bindIdempotentPayment,
  completeIdempotentRequest,
  requestHash,
} from "@/lib/v1/idempotency"
import { apiData, apiError, ApiError } from "@/lib/v1/http"
import { prepareV1Payment, settleV1Payment } from "@/lib/v1/payment"
import type { ServiceCatalogEntry } from "@/lib/v1/service-catalog"

export async function requireDashboardTenant(): Promise<Tenant> {
  const session = await getDashboardSession()
  if (!session) throw new ApiError("AUTH_REQUIRED", "Dashboard sign-in is required", 401)
  if (!session.tenantId) {
    throw new ApiError(
      "ONBOARDING_REQUIRED",
      "Create your first mailbox or phone number before using this action",
      428,
    )
  }
  const tenant = await getTenantById(session.tenantId)
  if (tenant.walletAddress !== session.walletAddress) {
    throw new ApiError("FORBIDDEN", "Dashboard wallet does not own this tenant", 403)
  }
  return tenant
}

export async function dashboardPaid(
  request: NextRequest,
  service: ServiceCatalogEntry,
  body: Record<string, unknown>,
  handler: (tenant: Tenant, input: Record<string, unknown>) => Promise<{ status?: number; body: unknown }>,
) {
  try {
    if (!service.paid || !service.x402Price || !service.available) {
      throw new ApiError("SERVICE_UNAVAILABLE", "This paid service is unavailable", 503)
    }
    const session = await getDashboardSession()
    if (!session) throw new ApiError("AUTH_REQUIRED", "Dashboard sign-in is required", 401)
    const existingTenant = session.tenantId ? await getTenantById(session.tenantId) : null
    if (existingTenant && existingTenant.walletAddress !== session.walletAddress) {
      throw new ApiError("FORBIDDEN", "Dashboard wallet does not own this tenant", 403)
    }
    if (!existingTenant && !service.startHere) {
      throw new ApiError(
        "ONBOARDING_REQUIRED",
        "Create your first mailbox or phone number before using this action",
        428,
      )
    }

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

    const key = request.headers.get("idempotency-key")?.trim()
    if (!key) throw new ApiError("IDEMPOTENCY_REQUIRED", "Idempotency-Key is required", 400)
    const payment = await prepareV1Payment(
      request,
      service.endpoint,
      service.x402Price,
      service.description,
      body,
    )
    if (payment.kind === "blocked") return payment.response
    if (payment.payer.toLowerCase() !== session.walletAddress) {
      throw new ApiError("FORBIDDEN", "Payment wallet must match the signed-in wallet", 403)
    }

    const hash = requestHash(body)
    let tenant: Tenant
    if (payment.kind === "settled") {
      if (
        payment.endpoint !== service.endpoint
        || payment.idempotencyKey !== key
        || payment.requestHash !== hash
      ) {
        throw new ApiError("PAYMENT_REPLAY_CONFLICT", "Payment proof belongs to another request", 409)
      }
      tenant = existingTenant ?? await getTenantById(payment.tenantId)
    } else {
      tenant = existingTenant ?? await getOrCreateTenant(payment.payer)
    }
    if (tenant.walletAddress !== session.walletAddress) {
      throw new ApiError("FORBIDDEN", "Payment belongs to another wallet", 403)
    }

    const state = await beginIdempotentRequest(tenant.id, service.endpoint, key, hash)
    if (state.kind === "conflict") {
      throw new ApiError("IDEMPOTENCY_CONFLICT", "This key was used for another request", 409)
    }
    if (state.kind === "replay") {
      return NextResponse.json(state.body, {
        status: state.status,
        headers: {
          ...(state.settlementHeader ? { "PAYMENT-RESPONSE": state.settlementHeader } : {}),
          "x-idempotent-replay": "true",
        },
      })
    }
    if (state.kind === "in_progress") {
      throw new ApiError("IDEMPOTENCY_IN_PROGRESS", "This operation is still processing", 409)
    }

    const settlement = payment.kind === "settled"
      ? payment
      : await settleV1Payment({
          payment,
          tenant,
          endpoint: service.endpoint,
          idempotencyKey: key,
          requestHash: hash,
        })
    await bindIdempotentPayment(
      tenant.id,
      service.endpoint,
      key,
      settlement.paymentPayloadHash,
      settlement.settlementHeader,
    )

    try {
      const result = await handler(tenant, body)
      const response = apiData(result.body, service.guide, result.status ?? 200)
      await completeIdempotentRequest(
        tenant.id,
        service.endpoint,
        key,
        response.status,
        await response.clone().json(),
        settlement.paymentPayloadHash,
        settlement.settlementHeader,
      )
      if (!session.tenantId) {
        await setDashboardSession({ tenantId: tenant.id, walletAddress: tenant.walletAddress })
      }
      response.headers.set("PAYMENT-RESPONSE", settlement.settlementHeader)
      return response
    } catch (error) {
      const response = apiError(error, service.guide)
      await completeIdempotentRequest(
        tenant.id,
        service.endpoint,
        key,
        response.status,
        await response.clone().json(),
        settlement.paymentPayloadHash,
        settlement.settlementHeader,
      )
      response.headers.set("PAYMENT-RESPONSE", settlement.settlementHeader)
      return response
    }
  } catch (error) {
    return apiError(error, service.guide)
  }
}
