import { NextRequest } from "next/server"
import { acknowledgeEvent } from "@/lib/v1/events"
import { v1Action } from "@/lib/v1/route"

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
