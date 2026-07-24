import { Resend } from "resend"
import { requireServerSupabase } from "@/lib/supabase"
import type { Tenant } from "./auth"
import { ApiError } from "./http"

type Mailbox = { id: string; email_address: string; display_name: string | null; outbound_signature: string | null; active: boolean }
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function resend(): Resend {
  const key = process.env.RESEND_API_KEY
  if (!key) throw new ApiError("provider_configuration_error", "RESEND_API_KEY is not configured", 503)
  return new Resend(key)
}
function emailDomain(): string {
  const domain = process.env.EMAIL_DOMAIN?.trim().toLowerCase()
  if (!domain || !emailPattern.test(`a@${domain}`)) throw new ApiError("provider_configuration_error", "EMAIL_DOMAIN is not configured", 503)
  return domain
}
function address(value: unknown, field: string): string {
  if (typeof value !== "string" || !emailPattern.test(value.trim())) throw new ApiError("invalid_request", `${field} must be a valid email address`)
  return value.trim().toLowerCase()
}
function addresses(value: unknown, field: string, required = false): string[] {
  if (value === undefined && !required) return []
  const raw = Array.isArray(value) ? value : [value]
  if (!raw.length) throw new ApiError("invalid_request", `${field} is required`)
  return raw.map(v => address(v, field))
}

export async function ownedMailbox(tenant: Tenant, mailboxId: string): Promise<Mailbox> {
  const db = requireServerSupabase()
  const { data, error } = await db.from("v1_mailboxes").select("id,email_address,display_name,outbound_signature,active").eq("id", mailboxId).eq("tenant_id", tenant.id).maybeSingle()
  if (error) throw new ApiError("provider_error", "Could not read mailbox", 503)
  if (!data) throw new ApiError("not_found", "Mailbox not found", 404)
  return data as Mailbox
}

export async function createMailbox(tenant: Tenant, input: Record<string, unknown>) {
  const localPart = typeof input.localPart === "string" ? input.localPart.trim().toLowerCase() : ""
  if (!/^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/.test(localPart)) throw new ApiError("invalid_request", "localPart must be 1–64 lowercase DNS-safe characters")
  const displayName = typeof input.displayName === "string" ? input.displayName.trim() : null
  const signature = typeof input.outboundSignature === "string" ? input.outboundSignature : null
  const db = requireServerSupabase()
  const { data, error } = await db.from("v1_mailboxes").insert({ tenant_id: tenant.id, local_part: localPart, email_address: `${localPart}@${emailDomain()}`, display_name: displayName, outbound_signature: signature }).select("id,email_address,display_name,outbound_signature,active,created_at").single()
  if (error?.code === "23505") throw new ApiError("conflict", "That mailbox already exists", 409)
  if (error || !data) throw new ApiError("provider_error", "Could not create mailbox", 503)
  return data
}

export async function queryMailboxes(tenant: Tenant) {
  const db = requireServerSupabase()
  const { data, error } = await db.from("v1_mailboxes").select("id,email_address,display_name,outbound_signature,active,created_at,updated_at").eq("tenant_id", tenant.id).order("created_at", { ascending: false })
  if (error) throw new ApiError("provider_error", "Could not query mailboxes", 503)
  return data ?? []
}

export async function updateMailbox(tenant: Tenant, mailboxId: string, input: Record<string, unknown>) {
  await ownedMailbox(tenant, mailboxId)
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (input.displayName !== undefined) patch.display_name = typeof input.displayName === "string" ? input.displayName.trim() : null
  if (input.outboundSignature !== undefined) patch.outbound_signature = typeof input.outboundSignature === "string" ? input.outboundSignature : null
  if (input.active !== undefined) {
    if (typeof input.active !== "boolean") throw new ApiError("invalid_request", "active must be boolean")
    patch.active = input.active
  }
  const { data, error } = await requireServerSupabase().from("v1_mailboxes").update(patch).eq("id", mailboxId).eq("tenant_id", tenant.id).select("id,email_address,display_name,outbound_signature,active,updated_at").single()
  if (error || !data) throw new ApiError("provider_error", "Could not update mailbox", 503)
  return data
}

export async function deleteMailbox(tenant: Tenant, mailboxId: string) {
  await ownedMailbox(tenant, mailboxId)
  const { error } = await requireServerSupabase().from("v1_mailboxes").delete().eq("id", mailboxId).eq("tenant_id", tenant.id)
  if (error) throw new ApiError("provider_error", "Could not delete mailbox", 503)
}

export async function sendMessage(tenant: Tenant, input: Record<string, unknown>) {
  const mailboxId = typeof input.mailboxId === "string" ? input.mailboxId : ""
  const mailbox = await ownedMailbox(tenant, mailboxId)
  if (!mailbox.active) throw new ApiError("conflict", "Mailbox is inactive", 409)
  const to = addresses(input.to, "to", true)
  const subject = typeof input.subject === "string" ? input.subject.trim() : ""
  const text = typeof input.text === "string" ? input.text : ""
  const html = typeof input.html === "string" ? input.html : undefined
  if (!subject || subject.length > 998 || (!text && !html)) throw new ApiError("invalid_request", "subject and text or html are required")
  const cc = addresses(input.cc, "cc")
  const bcc = addresses(input.bcc, "bcc")
  const replyTo = input.replyTo === undefined ? undefined : address(input.replyTo, "replyTo")
  const result = await resend().emails.send({
    from: mailbox.display_name ? `${mailbox.display_name} <${mailbox.email_address}>` : mailbox.email_address,
    to, cc: cc.length ? cc : undefined, bcc: bcc.length ? bcc : undefined, replyTo: replyTo ? [replyTo] : undefined,
    subject, text: `${text}${mailbox.outbound_signature ? `\n\n${mailbox.outbound_signature}` : ""}`, html,
  })
  if (result.error) throw new ApiError("provider_error", `Resend rejected the message: ${result.error.message}`, 502)
  const { data, error } = await requireServerSupabase().from("v1_messages").insert({
    tenant_id: tenant.id, mailbox_id: mailbox.id, provider_message_id: result.data?.id ?? null, direction: "outbound", from_address: mailbox.email_address,
    to_addresses: to, cc_addresses: cc, bcc_addresses: bcc, reply_to: replyTo ?? null, subject, text_body: text || null, html_body: html ?? null, status: "sent",
  }).select("id,provider_message_id,status,created_at").single()
  if (error || !data) throw new ApiError("provider_error", "Message was sent but could not be recorded; do not retry without checking Resend", 503)
  return data
}

export async function queryMessages(tenant: Tenant, input: { mailboxId?: string | null; messageId?: string | null; limit?: string | null }) {
  const db = requireServerSupabase()
  if (input.messageId) {
    const { data, error } = await db.from("v1_messages").select("*").eq("id", input.messageId).eq("tenant_id", tenant.id).maybeSingle()
    if (error) throw new ApiError("provider_error", "Could not query messages", 503)
    if (!data) throw new ApiError("not_found", "Message not found", 404)
    return data
  }
  const limit = Math.min(Math.max(Number(input.limit ?? 50) || 50, 1), 100)
  let query = db.from("v1_messages").select("id,mailbox_id,provider_message_id,provider_thread_id,direction,from_address,to_addresses,subject,status,created_at").eq("tenant_id", tenant.id).order("created_at", { ascending: false }).limit(limit)
  if (input.mailboxId) query = query.eq("mailbox_id", input.mailboxId)
  const { data, error } = await query
  if (error) throw new ApiError("provider_error", "Could not query messages", 503)
  return data ?? []
}
