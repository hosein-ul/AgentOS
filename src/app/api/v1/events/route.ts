import { NextRequest } from "next/server"
import { listPendingEvents } from "@/lib/v1/events"
import { v1Read } from "@/lib/v1/route"

export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  return v1Read(request, async (tenant) => {
    const raw = Number(request.nextUrl.searchParams.get("limit") ?? 100)
    const limit = Number.isInteger(raw) ? raw : 100
    return { items: await listPendingEvents(tenant, limit) }
  })
}
