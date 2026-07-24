import { NextRequest } from "next/server"
import { acknowledgeAllEvents } from "@/lib/v1/events"
import { v1Write } from "@/lib/v1/route"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  return v1Write(request, async (tenant, body) => ({
    body: await acknowledgeAllEvents(tenant, {
      before: body.before,
      types: body.types,
      service: body.service,
    }),
  }))
}
