import { NextRequest } from "next/server"
import { purchasePhoneNumber } from "@/lib/v1/phone"
import { v1Paid } from "@/lib/v1/route"
import { PHONE_SERVICES } from "@/lib/v1/service-catalog"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  const service = PHONE_SERVICES.purchaseUsNumber30Days
  return v1Paid(request, service.endpoint, service.x402Price, service.description, async (tenant, body) => ({
    status: 201,
    body: await purchasePhoneNumber(tenant, body, "US", service),
  }))
}
