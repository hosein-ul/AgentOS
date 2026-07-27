import { NextRequest, NextResponse } from "next/server"
import { requireServerSupabase } from "@/lib/supabase"
import {
  getAgentPhoneCall,
  stripProviderMediaFields,
  type AgentPhoneWebhookEvent,
  verifyAgentPhoneWebhook,
} from "@/lib/v1/agentphone"
import { createDurableEvent } from "@/lib/v1/events"
import { apiError, ApiError } from "@/lib/v1/http"
import { enqueueCallEnd } from "@/lib/v1/jobs"
import { decryptPhoneSecret } from "@/lib/v1/secrets"
import { requestVoiceTurn, voiceFallback } from "@/lib/v1/voice"

export const runtime = "nodejs"
export const maxDuration = 60

type PhoneRow = {
  id: string
  tenant_id: string
  phone_number: string
  provider_number_id: string
  provider_agent_id: string
  provider_sub_account_id: string | null
  lifecycle_status: string
  entitlement_expires_at: string | null
  inbound_seconds_balance: number
  inbound_seconds_reserved: number
  provider_webhook_secret_encrypted: string
}

function transcriptText(event: AgentPhoneWebhookEvent) {
  const data = event.data ?? {}
  for (const key of ["transcript", "text", "message", "utterance"]) {
    const value = (data as Record<string, unknown>)[key]
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 4_000)
  }
  return null
}

function stringField(value: unknown) {
  return typeof value === "string" && value ? value : null
}

async function findPhone(event: AgentPhoneWebhookEvent) {
  const agentId = stringField(event.agentId)
  const numberId = stringField(event.data?.numberId)
  if (!agentId && !numberId) return null
  const db = requireServerSupabase()
  let query = db
    .from("v1_phone_numbers")
    .select("id,tenant_id,phone_number,provider_number_id,provider_agent_id,provider_sub_account_id,lifecycle_status,entitlement_expires_at,inbound_seconds_balance,inbound_seconds_reserved,provider_webhook_secret_encrypted")
    .eq("provider", "agentphone")
  query = agentId ? query.eq("provider_agent_id", agentId) : query.eq("provider_number_id", numberId!)
  const { data, error } = await query.maybeSingle()
  if (error) throw new Error(`AgentPhone webhook routing failed: ${error.message}`)
  return data as PhoneRow | null
}

async function ensureInboundCall(phone: PhoneRow, event: AgentPhoneWebhookEvent) {
  const providerCallId = stringField(event.data?.callId)
  if (!providerCallId || event.channel !== "voice") return null
  const direction = event.data?.direction === "outbound" ? "outbound" : "inbound"
  if (direction === "outbound") return null
  const providerCall = await getAgentPhoneCall(providerCallId, phone.provider_sub_account_id)
  const { data, error } = await requireServerSupabase().rpc("v1_reserve_inbound_call", {
    p_tenant_id: phone.tenant_id,
    p_phone_number_id: phone.id,
    p_provider_call_id: providerCallId,
    p_provider_sub_account_id: phone.provider_sub_account_id,
    p_started_at: providerCall.startedAt ?? new Date().toISOString(),
    p_from_number: stringField(event.data?.from),
    p_to_number: stringField(event.data?.to) ?? phone.phone_number,
  })
  if (error || !data) {
    throw new Error(`Inbound call reservation failed: ${error?.message ?? "missing row"}`)
  }
  const call = Array.isArray(data) ? data[0] : data
  if (!call) throw new Error("Inbound call reservation returned no call")
  await enqueueCallEnd({
    tenantId: phone.tenant_id,
    callId: call.id,
    authorizedUntil: call.authorized_until,
  })
  return call
}

async function finishCall(phone: PhoneRow, event: AgentPhoneWebhookEvent) {
  const providerCallId = stringField(event.data?.callId)
  if (!providerCallId) return
  const db = requireServerSupabase()
  const { data: call, error } = await db
    .from("v1_calls")
    .select("*")
    .eq("provider", "agentphone")
    .eq("provider_call_id", providerCallId)
    .maybeSingle()
  if (error) throw new Error(`Completed call lookup failed: ${error.message}`)
  const duration = Math.max(0, Math.floor(Number(event.data?.durationSeconds ?? 0)))
  const transcript = Array.isArray(event.data?.transcript) ? stripProviderMediaFields(event.data?.transcript) : []
  if (call && !["completed", "failed", "ended", "canceled"].includes(call.status)) {
    if (call.direction === "inbound") {
      const { error: finalizeError } = await db.rpc("v1_finalize_inbound_call", {
        p_tenant_id: phone.tenant_id,
        p_phone_number_id: phone.id,
        p_provider_call_id: providerCallId,
        p_status: stringField(event.data?.status) ?? "completed",
        p_started_at: stringField(event.data?.startedAt),
        p_ended_at: stringField(event.data?.endedAt) ?? new Date().toISOString(),
        p_duration_seconds: duration,
        p_transcript: transcript,
      })
      if (finalizeError) throw new Error(`Inbound call finalization failed: ${finalizeError.message}`)
    } else {
      const { error: updateError } = await db.from("v1_calls").update({
        status: stringField(event.data?.status) ?? "completed",
        started_at: stringField(event.data?.startedAt) ?? call.started_at,
        ended_at: stringField(event.data?.endedAt) ?? new Date().toISOString(),
        duration_seconds: duration,
        transcript,
        updated_at: new Date().toISOString(),
      }).eq("id", call.id).eq("tenant_id", phone.tenant_id)
      if (updateError) throw new Error(`Outbound call finalization failed: ${updateError.message}`)
    }
  }
  await createDurableEvent({
    tenantId: phone.tenant_id,
    eventKey: `agentphone:${providerCallId}:ended`,
    type: "phone.call.ended",
    service: "phone",
    resourceType: "call",
    resourceId: call?.id ?? providerCallId,
    payload: {
      callId: call?.id ?? null,
      providerCallId,
      phoneNumberId: phone.id,
      direction: event.data?.direction,
      status: event.data?.status,
      startedAt: event.data?.startedAt,
      endedAt: event.data?.endedAt,
      durationSeconds: duration,
      transcript,
    },
  })
}

async function markProcessed(webhookId: string) {
  await requireServerSupabase()
    .from("v1_webhook_events")
    .update({ processed_at: new Date().toISOString() })
    .eq("provider", "agentphone")
    .eq("provider_event_id", webhookId)
}

export async function POST(request: NextRequest) {
  try {
    const raw = await request.text()
    const parsed = JSON.parse(raw) as AgentPhoneWebhookEvent
    const event = stripProviderMediaFields(parsed) as AgentPhoneWebhookEvent
    const phone = await findPhone(event)
    if (!phone?.provider_webhook_secret_encrypted) {
      throw new ApiError("forbidden", "Webhook does not map to a configured AgentPhone agent", 401)
    }
    const webhookId = verifyAgentPhoneWebhook(
      raw,
      request.headers,
      decryptPhoneSecret(phone.provider_webhook_secret_encrypted),
    )
    const db = requireServerSupabase()
    const { error: insertError } = await db.from("v1_webhook_events").insert({
      provider: "agentphone",
      provider_event_id: webhookId,
      payload: event,
    })
    if (insertError?.code === "23505") {
      const { data: existing } = await db.from("v1_webhook_events")
        .select("processed_at")
        .eq("provider", "agentphone")
        .eq("provider_event_id", webhookId)
        .maybeSingle()
      if (existing?.processed_at) return NextResponse.json({ received: true, duplicate: true })
    } else if (insertError) {
      throw new Error(`AgentPhone webhook persistence failed: ${insertError.message}`)
    }

    const expired = phone.entitlement_expires_at
      ? new Date(phone.entitlement_expires_at).getTime() <= Date.now()
      : true
    if (!["active", "renewal_due", "renewal_authorized"].includes(phone.lifecycle_status) || expired) {
      await markProcessed(webhookId)
      if (event.channel === "voice") {
        return NextResponse.json({ text: "This number is not active.", hangup: true })
      }
      return NextResponse.json({ received: true, ignored: "inactive number" })
    }

    const call = await ensureInboundCall(phone, event)
    if (event.event === "agent.call_ended") {
      await finishCall(phone, event)
      await markProcessed(webhookId)
      return NextResponse.json({ received: true })
    }
    if (event.channel === "voice" && event.event === "agent.message" && call?.direction === "inbound" && Number(call.authorized_seconds) <= 0) {
      await markProcessed(webhookId)
      return NextResponse.json({ text: "Inbound calling time is unavailable.", hangup: true })
    }

    // Live voice turn: the caller is on the line, so this must answer within a
    // strict deadline. AgentOS brokers the turn to the tenant's connected Agent
    // socket through the realtime gateway; it never calls a customer webhook and
    // never substitutes a durable notification for a synchronous turn.
    if (event.channel === "voice" && event.event === "agent.message") {
      const turn = await requestVoiceTurn({
        tenantId: phone.tenant_id,
        callId: call?.id ?? null,
        phoneNumberId: phone.id,
        providerCallId: stringField(event.data?.callId),
        direction: call?.direction ?? (stringField(event.data?.direction) ?? null),
        fromNumber: stringField(event.data?.from),
        toNumber: stringField(event.data?.to) ?? phone.phone_number,
        transcript: transcriptText(event),
        event: event.event,
      })
      await markProcessed(webhookId)
      const reply = turn.status === "answered" && turn.response
        ? turn.response
        : voiceFallback(turn.status)
      return NextResponse.json(reply, { headers: { "cache-control": "no-store" } })
    }
    await markProcessed(webhookId)
    return NextResponse.json({ received: true })
  } catch (error) {
    return apiError(error, "/docs#agentphone-webhook")
  }
}
