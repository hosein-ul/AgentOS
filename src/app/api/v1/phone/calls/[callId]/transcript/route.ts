import { NextRequest } from "next/server"
import { getCallTranscript } from "@/lib/v1/phone"
import { v1Read } from "@/lib/v1/route"

export const runtime = "nodejs"

export async function GET(request: NextRequest, context: { params: Promise<{ callId: string }> }) {
  const { callId } = await context.params
  return v1Read(request, (tenant) => getCallTranscript(tenant, callId))
}
