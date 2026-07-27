import { NextRequest, NextResponse } from "next/server"
import { dashboardOrigin, setDashboardSession, verifyDashboardSignature } from "@/lib/dashboard-auth"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const session = await verifyDashboardSignature({ walletAddress: String(body.walletAddress ?? ""), nonce: String(body.nonce ?? ""), signature: String(body.signature ?? ""), origin: dashboardOrigin(request.nextUrl.origin) })
    await setDashboardSession(session)
    return NextResponse.json({ walletAddress: session.walletAddress }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not verify signature" }, { status: 401 })
  }
}
