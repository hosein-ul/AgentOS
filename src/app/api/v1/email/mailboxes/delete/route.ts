import { NextRequest } from "next/server"
import { deleteMailbox } from "@/lib/v1/email"
import { v1Paid } from "@/lib/v1/route"
import { ApiError } from "@/lib/v1/http"
import { EMAIL_SERVICES } from "@/lib/v1/service-catalog"
import { serviceGuideResponse } from "@/lib/v1/guide"
export const runtime = "nodejs"
export async function POST(request: NextRequest) { const service = EMAIL_SERVICES.deleteMailbox; return v1Paid(request, service.endpoint, service.x402Price!, service.description, async (tenant, body) => { if (typeof body.mailboxId !== "string") throw new ApiError("invalid_request", "mailboxId is required"); await deleteMailbox(tenant, body.mailboxId); return { body: { deleted: true, mailboxId: body.mailboxId } } }) }

// GET returns the machine-readable usage guide for this operation. It executes
// nothing, contacts no provider, creates no payment and mutates no data.
export async function GET() {
  return serviceGuideResponse("email.mailbox.delete")
}
