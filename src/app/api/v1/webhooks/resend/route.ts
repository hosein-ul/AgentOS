import { NextRequest, NextResponse } from "next/server"
import { requireServerSupabase } from "@/lib/supabase"
import { getReceivedEmail, verifyWebhook } from "@/lib/resend"
import { ApiError, apiError, readBoundedText } from "@/lib/v1/http"
import { createDurableEvent } from "@/lib/v1/events"

export const runtime = "nodejs"
export async function POST(request: NextRequest) {
  try {
    const secret = process.env.RESEND_WEBHOOK_SECRET
    if (!secret) throw new ApiError("provider_configuration_error", "RESEND_WEBHOOK_SECRET is not configured", 503)
    // Provider webhooks are bounded before the signature is computed over them.
    const raw = await readBoundedText(request)
    const event = verifyWebhook(raw, { id: request.headers.get("svix-id"), timestamp: request.headers.get("svix-timestamp"), signature: request.headers.get("svix-signature") }, secret)
    const eventId = request.headers.get("svix-id")
    if (!eventId) throw new ApiError("forbidden", "Missing Resend event identifier", 401)
    const db = requireServerSupabase()
    const { error: eventError } = await db.from("v1_webhook_events").insert({
      provider: "resend",
      provider_event_id: eventId,
      payload: event,
    })
    if (eventError?.code === "23505") {
      const { data: existing } = await db.from("v1_webhook_events")
        .select("processed_at")
        .eq("provider", "resend")
        .eq("provider_event_id", eventId)
        .maybeSingle()
      if (existing?.processed_at) return NextResponse.json({ received: true, duplicate: true })
    }
    if (eventError && eventError.code !== "23505") throw eventError
    if (event.type !== "email.received") {
      await db.from("v1_webhook_events")
        .update({ processed_at: new Date().toISOString() })
        .eq("provider", "resend")
        .eq("provider_event_id", eventId)
      return NextResponse.json({ received: true })
    }
    const messageId = typeof event.data.email_id === "string" ? event.data.email_id : null
    if (!messageId) throw new ApiError("invalid_request", "Resend inbound event missing email_id", 400)
    const received = await getReceivedEmail(messageId)
    const recipientAddresses = received.to.map(address => address.toLowerCase()).filter(Boolean)
    const { data: mailboxes, error: mailboxError } = await db.from("v1_mailboxes")
      .select("id,tenant_id,email_address")
      .in("email_address", recipientAddresses)
      .eq("active", true)
    if (mailboxError) throw mailboxError
    if (!mailboxes?.length) {
      await db.from("v1_webhook_events")
        .update({ processed_at: new Date().toISOString() })
        .eq("provider", "resend")
        .eq("provider_event_id", eventId)
      return NextResponse.json({ received: true, ignored: true })
    }
    for (const mailbox of mailboxes) {
      const { data: inserted, error } = await db.from("v1_messages")
        .upsert({
          tenant_id: mailbox.tenant_id,
          mailbox_id: mailbox.id,
          provider_message_id: messageId,
          direction: "inbound",
          from_address: received.from,
          to_addresses: received.to,
          subject: received.subject,
          text_body: received.text,
          html_body: received.html,
          status: "received",
          metadata: { attachments: received.attachments },
        }, { onConflict: "mailbox_id,provider_message_id", ignoreDuplicates: true })
        .select("id,created_at")
        .maybeSingle()
      if (error) throw error
      let stored = inserted
      if (!stored) {
        const { data: existingMessage, error: lookupError } = await db.from("v1_messages")
          .select("id,created_at")
          .eq("mailbox_id", mailbox.id)
          .eq("provider_message_id", messageId)
          .single()
        if (lookupError) throw lookupError
        stored = existingMessage
      }
      await createDurableEvent({
        tenantId: mailbox.tenant_id,
        eventKey: `resend:${eventId}:mailbox:${mailbox.id}`,
        type: "email.received",
        service: "email",
        resourceType: "email",
        resourceId: stored.id,
        payload: {
          eventId,
          mailboxId: mailbox.id,
          emailId: stored.id,
          from: received.from,
          subject: received.subject,
          receivedAt: stored.created_at,
        },
      })
    }
    await db.from("v1_webhook_events")
      .update({ processed_at: new Date().toISOString() })
      .eq("provider", "resend")
      .eq("provider_event_id", eventId)
    return NextResponse.json({ received: true, mailboxes: mailboxes.length })
  } catch (error) { return apiError(error, "/docs#email-messages") }
}
