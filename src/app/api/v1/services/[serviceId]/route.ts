import { NextResponse } from "next/server"
import { getServiceById } from "@/lib/v1/service-catalog"
import { operationGuide } from "@/lib/v1/guide"

export const runtime = "nodejs"

export async function GET(
  _request: Request,
  context: { params: Promise<{ serviceId: string }> },
) {
  const { serviceId } = await context.params
  const service = getServiceById(decodeURIComponent(serviceId))
  if (!service) {
    return NextResponse.json({
      error: { code: "RESOURCE_NOT_FOUND", message: "Unknown AgentOS service ID" },
      serviceCatalog: "/api/v1/services",
      guides: { docs: "/docs", llms: "/llms.txt", openapi: "/openapi.json" },
    }, { status: 404 })
  }
  return NextResponse.json({
    data: service,
    // The same machine-readable guide a GET on the operation's own path returns.
    // This is the linked guide for GET-native endpoints, whose GET must keep its
    // normal business behaviour.
    usageGuide: operationGuide(service),
    guides: { docs: service.guide, llms: "/llms.txt", openapi: "/openapi.json" },
  }, { headers: { "cache-control": "public, max-age=300" } })
}
