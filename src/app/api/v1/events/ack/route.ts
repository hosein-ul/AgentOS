import { NextRequest } from "next/server"
import { acknowledgeEvent } from "@/lib/v1/events"
import { ApiError } from "@/lib/v1/http"
import { v1Write } from "@/lib/v1/route"
import { serviceGuideResponse } from "@/lib/v1/guide"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  return v1Write(request, async (tenant, body) => {
    if (typeof body.eventId !== "string") {
      throw new ApiError("INVALID_REQUEST", "eventId is required", 400)
    }
    return { body: await acknowledgeEvent(tenant, body.eventId) }
  })
}

// GET returns the machine-readable usage guide for this operation. It executes
// nothing, contacts no provider, creates no payment and mutates no data.
export async function GET() {
  return serviceGuideResponse("events.ack")
}
