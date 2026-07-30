import "server-only"

import { NextRequest, NextResponse } from "next/server"
import { getDashboardSession, setDashboardSession } from "@/lib/dashboard-auth"
import {
  getOrCreateTenant,
  getTenantById,
  type Tenant,
} from "@/lib/v1/auth"
import { apiData, apiError, ApiError } from "@/lib/v1/http"
import {
  prepareV1Payment,
  recordPaidResponse,
  requestHash,
  settleV1Payment,
} from "@/lib/v1/payment"
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

    const payment = await prepareV1Payment(
      request,
      service.endpoint,
      service.x402Price,
      service.description,
    )
    if (payment.kind === "blocked") return payment.response
    if (payment.payer.toLowerCase() !== session.walletAddress) {
      throw new ApiError("FORBIDDEN", "Payment wallet must match the signed-in wallet", 403)
    }

    const hash = requestHash(body)
    let tenant: Tenant
    if (payment.kind === "settled") {
      if (payment.endpoint !== service.endpoint || payment.requestHash !== hash) {
        throw new ApiError("PAYMENT_REPLAY_CONFLICT", "Payment proof belongs to another request", 409)
      }
      tenant = existingTenant ?? await getTenantById(payment.tenantId)
    } else {
      tenant = existingTenant ?? await getOrCreateTenant(payment.payer)
    }
    if (tenant.walletAddress !== session.walletAddress) {
      throw new ApiError("FORBIDDEN", "Payment belongs to another wallet", 403)
    }

    // This payment proof already ran its operation; replay the stored result
    // rather than charging the provider a second time.
    if (payment.kind === "settled" && payment.responseStatus !== null) {
      return NextResponse.json(payment.responseBody, {
        status: payment.responseStatus,
        headers: {
          ...(payment.settlementHeader ? { "PAYMENT-RESPONSE": payment.settlementHeader } : {}),
          "x-payment-replay": "true",
        },
      })
    }

    const settlement = payment.kind === "settled"
      ? payment
      : await settleV1Payment({
          payment,
          tenant,
          endpoint: service.endpoint,
          requestHash: hash,
        })

    try {
      const result = await handler(tenant, body)
      const response = apiData(result.body, service.guide, result.status ?? 200)
      await recordPaidResponse(
        settlement.paymentPayloadHash,
        response.status,
        await response.clone().json(),
      )
      if (!session.tenantId) {
        await setDashboardSession({ tenantId: tenant.id, walletAddress: tenant.walletAddress })
      }
      response.headers.set("PAYMENT-RESPONSE", settlement.settlementHeader)
      return response
    } catch (error) {
      const response = apiError(error, service.guide)
      await recordPaidResponse(
        settlement.paymentPayloadHash,
        response.status,
        await response.clone().json(),
      )
      response.headers.set("PAYMENT-RESPONSE", settlement.settlementHeader)
      return response
    }
  } catch (error) {
    return apiError(error, service.guide)
  }
}
