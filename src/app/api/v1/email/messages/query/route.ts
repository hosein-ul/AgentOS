import { NextRequest } from "next/server"
import { queryMessages } from "@/lib/v1/email"
import { v1Read } from "@/lib/v1/route"
export const runtime = "nodejs"
export async function GET(request: NextRequest) { return v1Read(request, tenant => queryMessages(tenant, { mailboxId: request.nextUrl.searchParams.get("mailboxId"), messageId: request.nextUrl.searchParams.get("messageId"), limit: request.nextUrl.searchParams.get("limit") }), "email.message.query") }
