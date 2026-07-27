import { NextRequest, NextResponse } from "next/server"
import { queryMailboxes } from "@/lib/v1/email"
import { v1Read } from "@/lib/v1/route"
export const runtime = "nodejs"
export async function GET(request: NextRequest) { return v1Read(request, queryMailboxes, "email.mailbox.list") }
export async function POST() { return NextResponse.json({ error: { code: "method_not_allowed", message: "Use GET /api/v1/email/mailboxes/query" }, guide: "/docs#email-mailboxes" }, { status: 405 }) }
