import { NextRequest } from "next/server"
import { purchasePhoneNumber } from "@/lib/v1/phone"
import { v1Paid } from "@/lib/v1/route"
import { PHONE_SERVICES } from "@/lib/v1/service-catalog"
import { serviceGuideResponse } from "@/lib/v1/guide"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  const service = PHONE_SERVICES.purchaseCanadaNumber30Days
  return v1Paid(request, service.endpoint, service.x402Price, service.description, async (tenant, body) => ({
    status: 201,
    body: await purchasePhoneNumber(tenant, body, "CA", service),
  }))
}

// GET returns the machine-readable usage guide for this operation. It executes
// nothing, contacts no provider, creates no payment and mutates no data.
export async function GET() {
  return serviceGuideResponse("phone.number.ca.30d")
}
