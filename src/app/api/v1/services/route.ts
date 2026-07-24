import { NextRequest, NextResponse } from "next/server"
import { SERVICE_CATALOG, type ServiceArea } from "@/lib/v1/service-catalog"

export const runtime = "nodejs"

const areas = new Set<ServiceArea>(["discovery", "events", "email", "phone", "domain"])

export async function GET(request: NextRequest) {
  const requestedArea = request.nextUrl.searchParams.get("area")
  if (requestedArea && !areas.has(requestedArea as ServiceArea)) {
    return NextResponse.json({
      error: {
        code: "INVALID_REQUEST",
        message: "area must be discovery, events, email, phone, or domain",
      },
      guides: { docs: "/docs", llms: "/llms.txt", openapi: "/openapi.json" },
    }, { status: 400 })
  }
  const services = requestedArea
    ? SERVICE_CATALOG.filter((service) => service.area === requestedArea)
    : SERVICE_CATALOG
  return NextResponse.json({
    data: {
      services,
      okxRegistration: services.filter((service) => service.registerOnOkx && service.available).map((service) => service.id),
      excludedInfrastructure: [
        "/api/v1/webhooks/agentphone",
        "/api/v1/webhooks/resend",
        "/api/v1/internal/phone-worker",
        "Supabase Realtime WebSocket",
      ],
    },
    guides: { docs: "/docs", llms: "/llms.txt", openapi: "/openapi.json" },
  }, { headers: { "cache-control": "public, max-age=300" } })
}
