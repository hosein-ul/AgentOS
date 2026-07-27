import { NextRequest } from "next/server"
import { releasePhoneNumber } from "@/lib/v1/phone"
import { v1Write } from "@/lib/v1/route"
import { serviceGuideResponse } from "@/lib/v1/guide"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  return v1Write(request, async (tenant, body) => ({
    body: await releasePhoneNumber(tenant, body),
  }))
}

// GET returns the machine-readable usage guide for this operation. It executes
// nothing, contacts no provider, creates no payment and mutates no data.
export async function GET() {
  return serviceGuideResponse("phone.number.release")
}
