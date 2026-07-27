import { NextRequest } from "next/server"
import { extendActiveCall } from "@/lib/v1/phone"
import { v1Paid } from "@/lib/v1/route"
import { PHONE_SERVICES } from "@/lib/v1/service-catalog"
import { serviceGuideResponse } from "@/lib/v1/guide"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  const service = PHONE_SERVICES.extendCall1Minute
  return v1Paid(request, service.endpoint, service.x402Price, service.description, async (tenant, body) => ({
    body: await extendActiveCall(tenant, body),
  }))
}

// GET returns the machine-readable usage guide for this operation. It executes
// nothing, contacts no provider, creates no payment and mutates no data.
export async function GET() {
  return serviceGuideResponse("phone.call.extend.1m")
}
