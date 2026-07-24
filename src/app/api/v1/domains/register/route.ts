import { NextResponse } from "next/server"

export const runtime = "nodejs"

// A single variable-price registration endpoint cannot be listed as one
// fixed-price OKX.AI service. Keep it fail-closed until per-TLD endpoints and
// stable Namecheap egress are configured.
export async function POST() {
  return NextResponse.json({
    error: {
      code: "service_not_listed",
      message: "Domain registration is disabled until fixed per-TLD ASP endpoints and stable Namecheap egress are configured.",
    },
    guide: "/docs#domains",
  }, { status: 503 })
}
