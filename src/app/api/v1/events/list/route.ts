import { NextRequest } from "next/server"
import { listEvents, type EventStatus } from "@/lib/v1/events"
import { v1Write } from "@/lib/v1/route"
import { serviceGuideResponse } from "@/lib/v1/guide"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  return v1Write(request, async (tenant, body) => ({
    body: await listEvents(tenant, {
      status: typeof body.status === "string" ? body.status as EventStatus : undefined,
      types: Array.isArray(body.types) ? body.types.filter((value): value is string => typeof value === "string") : undefined,
      agentId: typeof body.agentId === "string" ? body.agentId : undefined,
      service: typeof body.service === "string" ? body.service : undefined,
      resourceId: typeof body.resourceId === "string" ? body.resourceId : undefined,
      from: typeof body.from === "string" ? body.from : undefined,
      to: typeof body.to === "string" ? body.to : undefined,
      limit: typeof body.limit === "number" ? body.limit : undefined,
      cursor: typeof body.cursor === "string" ? body.cursor : undefined,
    }),
  }))
}

// GET returns the machine-readable usage guide for this operation. It executes
// nothing, contacts no provider, creates no payment and mutates no data.
export async function GET() {
  return serviceGuideResponse("events.list")
}
