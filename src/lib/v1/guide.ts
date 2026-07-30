import { NextResponse } from "next/server"
import { appUrl } from "./config"
import { getServiceById, type ServiceCatalogEntry } from "./service-catalog"
import { buildOperationGuide } from "./guide-data"
import { v1PaymentChallenge } from "./payment"

export { buildOperationGuide }

/** Catalog-wired guide for one service. */
export function operationGuide(service: ServiceCatalogEntry) {
  return buildOperationGuide(service, {
    baseUrl: appUrl(),
    nextService: service.nextServiceId ? getServiceById(service.nextServiceId) : null,
  })
}

/**
 * GET handler for a non-GET operation. Read-only by construction: it executes
 * nothing and only reads the in-process catalog.
 *
 * For a paid operation a bare GET is how a buyer agent discovers the endpoint —
 * payment clients probe with GET before anything else — so it answers with the
 * x402 challenge instead of a 200 that reads as "this resource is free". The
 * usage guide travels inside the challenge body, so no information is lost, and
 * the challenge declares POST as the method to replay with.
 */
export async function serviceGuideResponse(serviceId: string) {
  const service = getServiceById(serviceId)
  if (!service) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: `Unknown service ${serviceId}` }, guide: "/docs" },
      { status: 404 },
    )
  }
  const guide = operationGuide(service)
  if (!service.paid || !service.x402Price) {
    return NextResponse.json(guide, { headers: { "cache-control": "public, max-age=300" } })
  }
  const challenge = await v1PaymentChallenge(service.endpoint, service.x402Price, service.description)
  const payload = await challenge.response.clone().json() as Record<string, unknown>
  return NextResponse.json({ ...guide, ...payload }, {
    status: challenge.response.status,
    headers: challenge.response.headers,
  })
}
