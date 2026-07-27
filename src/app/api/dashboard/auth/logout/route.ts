import { NextResponse } from "next/server"
import { clearDashboardSession } from "@/lib/dashboard-auth"

export async function POST() {
  await clearDashboardSession()
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } })
}
