import { NextRequest } from "next/server"
import { v1Paid } from "@/lib/v1/route"
import { createMailbox } from "@/lib/v1/email"
import { EMAIL_SERVICES } from "@/lib/v1/service-catalog"
import { serviceGuideResponse } from "@/lib/v1/guide"

export const runtime = "nodejs"
export async function POST(request: NextRequest) { const service = EMAIL_SERVICES.createMailbox; return v1Paid(request, service.endpoint, service.x402Price!, service.description, async (tenant, body) => ({ status: 201, body: await createMailbox(tenant, body) })) }

// GET returns the machine-readable usage guide for this operation. It executes
// nothing, contacts no provider, creates no payment and mutates no data.
export async function GET() {
  return serviceGuideResponse("email.mailbox.create")
}
