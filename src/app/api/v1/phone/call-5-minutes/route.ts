import { NextRequest } from "next/server"
import { startOutboundCall } from "@/lib/v1/phone"
import { v1Paid } from "@/lib/v1/route"
import { PHONE_SERVICES } from "@/lib/v1/service-catalog"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  const service = PHONE_SERVICES.outboundCall5Minutes
  return v1Paid(request, service.endpoint, service.x402Price, service.description, async (tenant, body) => ({
    status: 201,
    body: await startOutboundCall(tenant, body, service, 300),
  }))
}
