import { NextRequest } from "next/server"
import { updateMailbox } from "@/lib/v1/email"
import { v1Paid } from "@/lib/v1/route"
import { EMAIL_SERVICES } from "@/lib/v1/service-catalog"
export const runtime = "nodejs"
export async function POST(request: NextRequest) { const service = EMAIL_SERVICES.updateMailbox; return v1Paid(request, service.endpoint, service.x402Price!, service.description, async (tenant, body) => ({ body: await updateMailbox(tenant, typeof body.mailboxId === "string" ? body.mailboxId : "", body) })) }
