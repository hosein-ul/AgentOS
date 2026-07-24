import { NextRequest } from "next/server"
import { releasePhoneNumber } from "@/lib/v1/phone"
import { v1Write } from "@/lib/v1/route"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  return v1Write(request, async (tenant, body) => ({
    body: await releasePhoneNumber(tenant, body),
  }))
}
