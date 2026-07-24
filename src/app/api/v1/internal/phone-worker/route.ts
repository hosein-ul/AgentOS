import { NextRequest, NextResponse } from "next/server"
import { runDueJobs } from "@/lib/v1/jobs"
import { apiError } from "@/lib/v1/http"

export const runtime = "nodejs"
export const maxDuration = 30

async function runWorker(request: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET
    if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
      return NextResponse.json({ error: { code: "unauthorized", message: "Worker authentication failed" } }, { status: 401 })
    }
    const repair = Boolean(request.headers.get("x-vercel-cron-schedule"))
      || request.nextUrl.searchParams.get("repair") === "true"
    const result = await runDueJobs(25, { repair })
    return NextResponse.json({
      data: {
        ...result,
        repair,
        mode: "short-idempotent-batch",
        instruction: "A continuously running external worker invokes this endpoint for call deadlines; Vercel Cron is only a safety sweep.",
      },
    }, { headers: { "cache-control": "no-store" } })
  } catch (error) {
    return apiError(error, "/docs#phone-worker")
  }
}

export const GET = runWorker
export const POST = runWorker
