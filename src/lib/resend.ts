import { Resend } from "resend"

// Lazy singleton — no top-level side effects.
let _client: Resend | null = null
function getClient(): Resend {
  if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not set")
  if (!_client) _client = new Resend(process.env.RESEND_API_KEY)
  return _client
}

// ─── Public types ─────────────────────────────────────────────────────────────

export interface Attachment {
  filename: string
  content: string               // base64-encoded file data
  type?: string                 // MIME type, e.g. "application/pdf"
  disposition?: "attachment" | "inline"
}

export interface SendEmailParams {
  from: string
  to: string | string[]
  subject: string
  body: string                  // plain-text body
  html?: string
  cc?: string | string[]
  bcc?: string | string[]
  replyTo?: string
  inReplyTo?: string            // RFC 2822 Message-ID for thread linking
  attachments?: Attachment[]
  trackOpens?: boolean          // no-op — Resend configures tracking at the domain level
  trackClicks?: boolean         // no-op — same
  scheduledAt?: Date
}

// ─── Outbound ─────────────────────────────────────────────────────────────────

export async function sendEmail(params: SendEmailParams): Promise<{ success: true; messageId: string | undefined }> {
  const { from, to, subject, body, html, cc, bcc, replyTo, inReplyTo, attachments, scheduledAt } = params

  const toArr  = Array.isArray(to)  ? to  : [to]
  const ccArr  = cc  ? (Array.isArray(cc)  ? cc  : [cc])  : undefined
  const bccArr = bcc ? (Array.isArray(bcc) ? bcc : [bcc]) : undefined

  const { data, error } = await getClient().emails.send({
    from,
    to: toArr,
    subject,
    text: body,
    html: html ?? body,
    ...(ccArr  ? { cc: ccArr }   : {}),
    ...(bccArr ? { bcc: bccArr } : {}),
    ...(replyTo ? { replyTo: [replyTo] } : {}),
    ...(inReplyTo ? { headers: { "In-Reply-To": inReplyTo, References: inReplyTo } } : {}),
    ...(attachments?.length
      ? {
          attachments: attachments.map((a) => ({
            filename: a.filename,
            content: a.content,
            contentType: a.type ?? "application/octet-stream",
          })),
        }
      : {}),
    ...(scheduledAt ? { scheduledAt: scheduledAt.toISOString() } : {}),
  })

  if (error) throw new Error(`[Resend] send failed: ${error.message}`)

  return { success: true, messageId: data?.id }
}

// ─── Scheduled email management ───────────────────────────────────────────────

export async function cancelScheduledEmail(resendEmailId: string): Promise<void> {
  const { error } = await getClient().emails.cancel(resendEmailId)
  if (error) throw new Error(`[Resend] cancel failed: ${error.message}`)
}

// ─── Inbound (receiving) ──────────────────────────────────────────────────────

export interface ReceivedEmail {
  from: string
  to: string[]
  subject: string
  text: string | null
  html: string | null
  attachments: Array<{
    id: string
    filename: string | null
    content_type: string
    size: number
  }>
}

export async function getReceivedEmail(emailId: string): Promise<ReceivedEmail> {
  const { data, error } = await getClient().emails.receiving.get(emailId)
  if (error) throw new Error(`[Resend] retrieve received email failed: ${error.message}`)
  if (!data) throw new Error(`[Resend] no data returned for email ${emailId}`)
  return {
    from: data.from,
    to: data.to,
    subject: data.subject,
    text: data.text,
    html: data.html,
    attachments: data.attachments.map((a) => ({
      id: a.id,
      filename: a.filename,
      content_type: a.content_type,
      size: a.size,
    })),
  }
}

// ─── Webhook signature verification ──────────────────────────────────────────

export interface ResendWebhookEvent {
  type: string
  created_at: string
  data: Record<string, unknown>
}

export function verifyWebhook(
  payload: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  secret: string
): ResendWebhookEvent {
  // SDK requires a key to instantiate but signature verification is stateless.
  const client = new Resend(process.env.RESEND_API_KEY ?? "placeholder")
  const result = client.webhooks.verify({
    payload,
    headers: {
      id: headers.id ?? "",
      timestamp: headers.timestamp ?? "",
      signature: headers.signature ?? "",
    },
    webhookSecret: secret,
  })
  // Cast through unknown: WebhookEventPayload union → our simpler generic shape.
  return result as unknown as ResendWebhookEvent
}
