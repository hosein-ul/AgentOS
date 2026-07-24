import { NextRequest } from "next/server"
import { sendMessage } from "@/lib/v1/email"
import { v1Paid } from "@/lib/v1/route"
import { EMAIL_SERVICES } from "@/lib/v1/service-catalog"
export const runtime = "nodejs"
export async function POST(request: NextRequest) { const service = EMAIL_SERVICES.sendMessage; return v1Paid(request, service.endpoint, service.x402Price!, service.description, async (tenant, body) => ({ status: 201, body: await sendMessage(tenant, body) })) }
