import { NextRequest } from "next/server"
import { issueRealtimeToken } from "@/lib/v1/events"
import { v1Read } from "@/lib/v1/route"

export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  return v1Read(request, async (tenant) => ({
    realtime: issueRealtimeToken(tenant),
    reconnectRule: "Authenticate the WebSocket with the short-lived token. The gateway performs one leased deterministic replay. Send event.ack only after durable local handling; REST /api/v1/events/ack is the recovery path.",
  }))
}
