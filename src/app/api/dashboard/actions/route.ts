import { NextRequest } from "next/server"
import { apiData, apiError, ApiError, readJson } from "@/lib/v1/http"
import { requireDashboardTenant } from "@/lib/dashboard-route"
import { acknowledgeAllEvents, acknowledgeEvent } from "@/lib/v1/events"
import { releasePhoneNumber } from "@/lib/v1/phone"
import { issueAccessToken } from "@/lib/v1/auth"
import { requireServerSupabase } from "@/lib/supabase"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  try {
    const tenant = await requireDashboardTenant()
    const body = await readJson(request)
    switch (body.action) {
      case "phone.release":
        return apiData(await releasePhoneNumber(tenant, {
          phoneNumberId: body.phoneNumberId,
          confirmRelease: body.confirmRelease,
        }), "/docs#number-renewal")
      case "event.ack":
        if (typeof body.eventId !== "string") {
          throw new ApiError("INVALID_REQUEST", "eventId is required", 400)
        }
        return apiData(await acknowledgeEvent(tenant, body.eventId), "/docs#event-delivery")
      case "event.ack-all":
        return apiData(await acknowledgeAllEvents(tenant, {
          before: body.before,
          types: body.types,
          service: body.service,
        }), "/docs#event-delivery")
      case "token.create":
        return apiData(await issueAccessToken(tenant.id), "/docs#authentication-and-okx-x402", 201)
      case "token.revoke": {
        if (typeof body.tokenId !== "string") {
          throw new ApiError("INVALID_REQUEST", "tokenId is required", 400)
        }
        const { data, error } = await requireServerSupabase()
          .from("v1_access_tokens")
          .update({ revoked_at: new Date().toISOString() })
          .eq("id", body.tokenId)
          .eq("tenant_id", tenant.id)
          .is("revoked_at", null)
          .select("id")
          .maybeSingle()
        if (error) throw new ApiError("PROVIDER_ERROR", "Could not revoke token", 503)
        if (!data) throw new ApiError("NOT_FOUND", "Active token not found", 404)
        return apiData({ revoked: true, tokenId: body.tokenId }, "/docs#authentication-and-okx-x402")
      }
      default:
        throw new ApiError("INVALID_REQUEST", "Unknown dashboard action", 400)
    }
  } catch (error) {
    return apiError(error, "/docs")
  }
}
