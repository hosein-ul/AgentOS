import { NextResponse } from "next/server"
import { SERVICE_CATALOG } from "@/lib/v1/service-catalog"

export const runtime = "nodejs"

const guides = { docs: "/docs", llms: "/llms.txt", openapi: "/openapi.json" }

export async function GET() {
  return NextResponse.json({
    name: "AgentOS ASP",
    version: "v1",
    transport: "REST",
    payment: {
      protocol: "OKX x402",
      network: "X Layer",
      rule: "Every paid endpoint has its own fixed price and challenge.",
    },
    authentication: {
      tokenEndpoint: null,
      firstUse: "The first successful paid business operation returns the wallet-bound access token at no extra charge.",
      tokenExpiry: null,
      reuse: "Use the same token for every AgentOS service owned by the same payer wallet.",
    },
    guides,
    serviceCatalog: "/api/v1/services",
    services: SERVICE_CATALOG.map((service) => ({
      serviceId: service.id,
      area: service.area,
      method: service.method,
      endpoint: service.endpoint,
      fixedPrice: service.paid ? `${service.amount} ${service.currency}` : "free",
      authenticated: service.authenticated,
      startHere: service.startHere,
      available: service.available,
      registerOnOkx: service.registerOnOkx,
      guide: service.guide,
    })),
    recording: {
      enabled: false,
      exposed: false,
      transcriptsOnly: true,
    },
  }, {
    headers: { "cache-control": "public, max-age=300" },
  })
}
