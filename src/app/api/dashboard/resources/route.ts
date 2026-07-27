import { NextResponse } from "next/server"
import { getDashboardSession } from "@/lib/dashboard-auth"
import { getTenantDashboardData } from "@/lib/dashboard-data"

export async function GET() {
  try {
    const session = await getDashboardSession()
    if (!session) return NextResponse.json({ error: "Dashboard sign-in is required" }, { status: 401 })
    return NextResponse.json(await getTenantDashboardData(session.tenantId), { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load dashboard resources" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    )
  }
}
