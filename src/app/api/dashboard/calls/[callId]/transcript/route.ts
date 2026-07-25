import { NextRequest } from "next/server"
import { apiData, apiError, ApiError } from "@/lib/v1/http"
import { requireDashboardTenant } from "@/lib/dashboard-route"
import { getCallTranscript } from "@/lib/v1/phone"

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ callId: string }> },
) {
  try {
    const tenant = await requireDashboardTenant()
    const { callId } = await context.params
    if (!callId) throw new ApiError("INVALID_REQUEST", "callId is required", 400)
    return apiData(await getCallTranscript(tenant, callId), "/docs#phone-flow")
  } catch (error) {
    return apiError(error, "/docs#phone-flow")
  }
}
