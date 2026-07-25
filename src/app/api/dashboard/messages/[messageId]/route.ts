import { NextRequest } from "next/server"
import { apiData, apiError, ApiError } from "@/lib/v1/http"
import { requireDashboardTenant } from "@/lib/dashboard-route"
import { queryMessages } from "@/lib/v1/email"

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ messageId: string }> },
) {
  try {
    const tenant = await requireDashboardTenant()
    const { messageId } = await context.params
    if (!messageId) throw new ApiError("INVALID_REQUEST", "messageId is required", 400)
    return apiData(
      await queryMessages(tenant, { messageId }),
      "/docs#email-flow",
    )
  } catch (error) {
    return apiError(error, "/docs#email-flow")
  }
}
