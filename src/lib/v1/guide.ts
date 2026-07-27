import { NextResponse } from "next/server"
import { appUrl } from "./config"
import { getServiceById, type ServiceCatalogEntry } from "./service-catalog"
import { buildOperationGuide } from "./guide-data"

export { buildOperationGuide }

/** Catalog-wired guide for one service. */
export function operationGuide(service: ServiceCatalogEntry) {
  return buildOperationGuide(service, {
    baseUrl: appUrl(),
    nextService: service.nextServiceId ? getServiceById(service.nextServiceId) : null,
  })
}

/**
 * GET handler for a non-GET operation. Read-only by construction: it only reads
 * the in-process catalog.
 */
export function serviceGuideResponse(serviceId: string) {
  const service = getServiceById(serviceId)
  if (!service) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: `Unknown service ${serviceId}` }, guide: "/docs" },
      { status: 404 },
    )
  }
  return NextResponse.json(operationGuide(service), {
    headers: { "cache-control": "public, max-age=300" },
  })
}
