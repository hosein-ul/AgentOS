import { NextResponse } from "next/server"
import { serviceGuideResponse } from "@/lib/v1/guide"
import { DOMAIN_REGISTER_UNAVAILABLE } from "@/lib/v1/service-catalog"

export const runtime = "nodejs"

// Fail-closed. Returns 503 before doing anything else: no x402 challenge is
// issued, no payment is created or settled, and no registrar is contacted.
// Domain stays unavailable until Cloudflare-backed support is implemented.
export async function POST() {
  return NextResponse.json({
    error: {
      code: "SERVICE_UNAVAILABLE",
      message: "Domain registration is unavailable. Cloudflare-backed domain support is planned but not implemented; this endpoint never requests or settles a payment.",
    },
    service: {
      serviceId: DOMAIN_REGISTER_UNAVAILABLE.id,
      available: false,
      paid: false,
      x402Price: null,
      registerOnOkx: false,
      startHere: false,
    },
    payment: {
      settled: false,
      instruction: "Do not create or submit a payment for this response.",
    },
    guide: "/docs#domain-flow",
  }, { status: 503, headers: { "cache-control": "no-store" } })
}

// GET returns the machine-readable usage guide for this operation. It executes
// nothing, contacts no provider, creates no payment and mutates no data.
export async function GET() {
  return serviceGuideResponse("domain.register")
}
