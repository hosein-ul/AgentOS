import { NextRequest } from "next/server"
import { dashboardPaid } from "@/lib/dashboard-route"
import { apiError, ApiError, readJson } from "@/lib/v1/http"
import { createMailbox, deleteMailbox, sendMessage, updateMailbox } from "@/lib/v1/email"
import {
  addInboundMinutes,
  extendActiveCall,
  purchasePhoneNumber,
  renewPhoneNumber,
  startOutboundCall,
} from "@/lib/v1/phone"
import {
  EMAIL_SERVICES,
  PHONE_SERVICES,
  getServiceById,
} from "@/lib/v1/service-catalog"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  try {
    const envelope = await readJson(request)
    const serviceId = typeof envelope.serviceId === "string" ? envelope.serviceId : ""
    const input = envelope.input && typeof envelope.input === "object" && !Array.isArray(envelope.input)
      ? envelope.input as Record<string, unknown>
      : {}
    const service = getServiceById(serviceId)
    if (!service?.paid) {
      throw new ApiError("INVALID_REQUEST", "Unknown paid dashboard service", 400)
    }

    return dashboardPaid(request, service, input, async (tenant, body) => {
      switch (serviceId) {
        case EMAIL_SERVICES.createMailbox.id:
          return { status: 201, body: await createMailbox(tenant, body) }
        case EMAIL_SERVICES.updateMailbox.id:
          return { body: await updateMailbox(tenant, String(body.mailboxId ?? ""), body) }
        case EMAIL_SERVICES.deleteMailbox.id:
          await deleteMailbox(tenant, String(body.mailboxId ?? ""))
          return { body: { deleted: true, mailboxId: body.mailboxId } }
        case EMAIL_SERVICES.sendMessage.id:
          return { status: 201, body: await sendMessage(tenant, body) }
        case PHONE_SERVICES.purchaseUsNumber30Days.id:
          return { status: 201, body: await purchasePhoneNumber(tenant, body, "US", service) }
        case PHONE_SERVICES.purchaseCanadaNumber30Days.id:
          return { status: 201, body: await purchasePhoneNumber(tenant, body, "CA", service) }
        case PHONE_SERVICES.renewNumber30Days.id:
          return { body: await renewPhoneNumber(tenant, body) }
        case PHONE_SERVICES.outboundCall1Minute.id:
          return { status: 201, body: await startOutboundCall(tenant, body, service, 60) }
        case PHONE_SERVICES.outboundCall5Minutes.id:
          return { status: 201, body: await startOutboundCall(tenant, body, service, 300) }
        case PHONE_SERVICES.extendCall1Minute.id:
          return { body: await extendActiveCall(tenant, body) }
        case PHONE_SERVICES.addInboundMinutes10.id:
          return { body: await addInboundMinutes(tenant, body) }
        default:
          throw new ApiError("INVALID_REQUEST", "This service is not available in the dashboard", 400)
      }
    })
  } catch (error) {
    return apiError(error, "/docs")
  }
}
