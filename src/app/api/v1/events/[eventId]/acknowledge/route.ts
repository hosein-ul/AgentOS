import { NextRequest } from "next/server"
import { acknowledgeEvent } from "@/lib/v1/events"
import { v1Action } from "@/lib/v1/route"
import { serviceGuideResponse } from "@/lib/v1/guide"

export const runtime = "nodejs"

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await context.params
  return v1Action(request, async (tenant) => ({
    body: await acknowledgeEvent(tenant, eventId),
  }))
}

// GET returns the machine-readable usage guide for this operation. It executes
// nothing, contacts no provider, creates no payment and mutates no data.
export async function GET() {
  return serviceGuideResponse("events.ack")
}
