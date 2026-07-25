import { NextRequest, NextResponse } from "next/server"
import { createDashboardNonce } from "@/lib/dashboard-auth"

export async function POST(request: NextRequest) {
  try {
    const { walletAddress } = await request.json()
    return NextResponse.json(
      await createDashboardNonce(String(walletAddress ?? ""), request.nextUrl.origin),
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not start sign-in" },
      { status: 400 },
    )
  }
}
