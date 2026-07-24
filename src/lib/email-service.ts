import { createHmac } from "crypto"
import { supabase } from "./supabase"
import { sendEmail, cancelScheduledEmail, type Attachment } from "./resend"
import { v4 as uuidv4 } from "uuid"

const EMAIL_DOMAIN = process.env.EMAIL_DOMAIN || "zerolayer.online"

export function generateEmailAddress(agentName: string): string {
  const sanitized = agentName.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-")
  return `${sanitized}@${EMAIL_DOMAIN}`
}

// ─── MAILBOX MANAGEMENT ────────────────────────────────────────────────────

export async function createAgent(userId: string, name: string, opts?: {
  displayName?: string
  webhookUrl?: string
  signature?: string
}) {
  const emailAddress = generateEmailAddress(name)
  const { data: existing } = await supabase.from("Agent").select("id").eq("emailAddress", emailAddress).maybeSingle()
  const finalName = existing ? `${name}-${uuidv4().slice(0, 6)}` : name
  const finalEmail = existing ? generateEmailAddress(finalName) : emailAddress

  const { data: agent, error } = await supabase
    .from("Agent")
    .insert({
      name: finalName,
      emailAddress: finalEmail,
      userId,
      displayName: opts?.displayName ?? null,
      webhookUrl: opts?.webhookUrl ?? null,
      signature: opts?.signature ?? null,
    })
    .select()
    .single()

  if (error) throw new Error(`[Supabase] createAgent: ${error.message}`)
  return agent
}

export async function updateAgent(agentId: string, userId: string, fields: {
  displayName?: string
  signature?: string
  autoReply?: string
  autoReplyActive?: boolean
  webhookUrl?: string
  isActive?: boolean
}) {
  const { data: agent } = await supabase
    .from("Agent")
    .update(fields)
    .eq("id", agentId)
    .eq("userId", userId)
    .select()
    .single()
  return agent
}

export async function deleteAgent(agentId: string, userId: string) {
  await supabase.from("Email").delete().eq("agentId", agentId)
  const { error } = await supabase.from("Agent").delete().eq("id", agentId).eq("userId", userId)
  return !error
}

export async function listAgents(userId: string) {
  const { data: agents } = await supabase
    .from("Agent")
    .select("*")
    .eq("userId", userId)
    .order("createdAt", { ascending: false })

  if (!agents?.length) return []

  const { data: emailRows } = await supabase
    .from("Email")
    .select("agentId")
    .in("agentId", agents.map((a) => a.id))

  const countMap: Record<string, number> = {}
  for (const row of emailRows ?? []) {
    countMap[row.agentId] = (countMap[row.agentId] ?? 0) + 1
  }

  return agents.map((a) => ({ ...a, emailCount: countMap[a.id] ?? 0 }))
}

// ─── SENDING ───────────────────────────────────────────────────────────────

export async function sendAgentEmail(
  agentId: string,
  to: string | string[],
  subject: string,
  body: string,
  opts?: {
    html?: string
    cc?: string | string[]
    bcc?: string | string[]
    replyTo?: string
    inReplyTo?: string
    attachments?: Attachment[]
    trackOpens?: boolean
    trackClicks?: boolean
    scheduledAt?: Date
    threadId?: string
  }
) {
  const { data: agent } = await supabase.from("Agent").select("*").eq("id", agentId).single()
  if (!agent) throw new Error("Agent not found")
  if (!agent.isActive) throw new Error("Agent is deactivated")

  // Append signature if set
  const finalBody = agent.signature ? `${body}\n\n--\n${agent.signature}` : body
  const finalHtml = opts?.html
    ? agent.signature
      ? `${opts.html}<br><br>--<br>${agent.signature}`
      : opts.html
    : undefined

  const status = opts?.scheduledAt ? "scheduled" : "sent"
  const toStr = Array.isArray(to) ? to.join(", ") : to

  const result = await sendEmail({
    from: agent.emailAddress,
    to,
    subject,
    body: finalBody,
    html: finalHtml,
    cc: opts?.cc,
    bcc: opts?.bcc,
    replyTo: opts?.replyTo,
    inReplyTo: opts?.inReplyTo,
    attachments: opts?.attachments,
    trackOpens: opts?.trackOpens,
    trackClicks: opts?.trackClicks,
    scheduledAt: opts?.scheduledAt,
  })

  const { data: email } = await supabase
    .from("Email")
    .insert({
      agentId,
      messageId: result.messageId ?? null,
      from: agent.emailAddress,
      to: toStr,
      cc: opts?.cc ? (Array.isArray(opts.cc) ? opts.cc.join(", ") : opts.cc) : null,
      bcc: opts?.bcc ? (Array.isArray(opts.bcc) ? opts.bcc.join(", ") : opts.bcc) : null,
      replyTo: opts?.replyTo ?? null,
      subject,
      body: finalBody,
      html: finalHtml ?? null,
      direction: "outbound",
      threadId: opts?.threadId ?? uuidv4(),
      status,
      scheduledFor: opts?.scheduledAt?.toISOString() ?? null,
    })
    .select()
    .single()

  // Store attachments in DB
  if (opts?.attachments?.length && email) {
    await supabase.from("Attachment").insert(
      opts.attachments.map((a) => ({
        emailId: email.id,
        filename: a.filename,
        contentType: a.type ?? "application/octet-stream",
        size: Math.ceil((a.content.length * 3) / 4),
        content: a.content,
      }))
    )
  }

  return { email, deliveryResult: result }
}

export async function sendTemplate(
  agentId: string,
  userId: string,
  templateId: string,
  to: string | string[],
  variables: Record<string, string> = {},
  opts?: { cc?: string | string[]; bcc?: string | string[] }
) {
  const { data: template } = await supabase
    .from("EmailTemplate")
    .select("*")
    .eq("id", templateId)
    .eq("userId", userId)
    .maybeSingle()

  if (!template) throw new Error("Template not found")

  const render = (text: string) =>
    text.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] ?? `{{${key}}}`)

  const subject = render(template.subject)
  const body = render(template.body)
  const html = template.html ? render(template.html) : undefined

  return sendAgentEmail(agentId, to, subject, body, { html, cc: opts?.cc, bcc: opts?.bcc })
}

export async function sendBulk(
  agentId: string,
  userId: string,
  templateId: string,
  recipients: Array<{ to: string; variables?: Record<string, string> }>
) {
  const { data: template } = await supabase
    .from("EmailTemplate")
    .select("*")
    .eq("id", templateId)
    .eq("userId", userId)
    .maybeSingle()

  if (!template) throw new Error("Template not found")

  const render = (text: string, vars: Record<string, string> = {}) =>
    text.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`)

  const results = await Promise.allSettled(
    recipients.map((r) =>
      sendAgentEmail(agentId, r.to, render(template.subject, r.variables), render(template.body, r.variables), {
        html: template.html ? render(template.html, r.variables) : undefined,
      })
    )
  )

  return {
    total: recipients.length,
    sent: results.filter((r) => r.status === "fulfilled").length,
    failed: results.filter((r) => r.status === "rejected").length,
  }
}

export async function cancelScheduled(emailId: string) {
  const { data: email } = await supabase.from("Email").select("*").eq("id", emailId).maybeSingle()
  if (!email) throw new Error("Email not found")
  if (email.status !== "scheduled") throw new Error("Email is not scheduled")

  // Cancel in Resend using the provider email ID stored in messageId.
  if (email.messageId) {
    await cancelScheduledEmail(email.messageId)
  }

  const { data: updated } = await supabase
    .from("Email")
    .update({ status: "cancelled" })
    .eq("id", emailId)
    .select()
    .single()

  return updated
}

// ─── INBOX / READING ───────────────────────────────────────────────────────

export interface InboxFilter {
  unread?: boolean
  from?: string
  subject?: string
  dateFrom?: string
  dateTo?: string
  hasAttachment?: boolean
  direction?: "inbound" | "outbound" | "all"
}

export async function getInbox(agentId: string, limit = 50, offset = 0, filter?: InboxFilter) {
  let q = supabase.from("Email").select("*").eq("agentId", agentId)

  if (filter?.direction && filter.direction !== "all") {
    q = q.eq("direction", filter.direction)
  }
  if (filter?.unread === true)  q = q.eq("isRead", false)
  if (filter?.from)             q = q.ilike("from", `%${filter.from}%`)
  if (filter?.subject)          q = q.ilike("subject", `%${filter.subject}%`)
  if (filter?.dateFrom)         q = q.gte("createdAt", filter.dateFrom)
  if (filter?.dateTo)           q = q.lte("createdAt", filter.dateTo)

  q = q.order("createdAt", { ascending: false }).range(offset, offset + limit - 1)

  const { data: emails } = await q

  if (filter?.hasAttachment) {
    if (!emails?.length) return []
    const emailIds = emails.map((e) => e.id)
    const { data: attachRows } = await supabase
      .from("Attachment")
      .select("emailId")
      .in("emailId", emailIds)
    const withAttachment = new Set((attachRows ?? []).map((r) => r.emailId))
    return emails.filter((e) => withAttachment.has(e.id))
  }

  return emails ?? []
}

export async function getThread(threadId: string) {
  const { data } = await supabase
    .from("Email")
    .select("*, attachments:Attachment(*)")
    .eq("threadId", threadId)
    .order("createdAt", { ascending: true })

  return data ?? []
}

export async function searchEmails(agentId: string, query: string, limit = 20) {
  // Use ilike as fallback; once FTS index is created, switch to textSearch
  const { data } = await supabase
    .from("Email")
    .select("*")
    .eq("agentId", agentId)
    .or(`subject.ilike.%${query}%,body.ilike.%${query}%,from.ilike.%${query}%`)
    .order("createdAt", { ascending: false })
    .limit(limit)

  return data ?? []
}

// ─── ACTIONS ──────────────────────────────────────────────────────────────

export async function replyEmail(
  emailId: string,
  body: string,
  opts?: { html?: string; cc?: string | string[]; attachments?: Attachment[] }
) {
  const { data: original } = await supabase
    .from("Email")
    .select("*, agent:Agent(*)")
    .eq("id", emailId)
    .maybeSingle()

  if (!original) throw new Error("Email not found")

  return sendAgentEmail(original.agentId, original.from, `Re: ${original.subject}`, body, {
    html: opts?.html,
    cc: opts?.cc,
    replyTo: original.from,
    inReplyTo: original.messageId ?? undefined,
    attachments: opts?.attachments,
    threadId: original.threadId,
  })
}

export async function replyAll(emailId: string, body: string, html?: string) {
  const { data: original } = await supabase.from("Email").select("*").eq("id", emailId).maybeSingle()
  if (!original) throw new Error("Email not found")

  // CC: original recipients minus the agent's own address
  const originalCc = original.cc ? original.cc.split(",").map((s: string) => s.trim()) : []
  const originalTo = original.to.split(",").map((s: string) => s.trim())
  const ccAll = [...new Set([...originalTo, ...originalCc])].filter(
    (addr) => addr !== original.from
  )

  return sendAgentEmail(original.agentId, original.from, `Re: ${original.subject}`, body, {
    html,
    cc: ccAll.length ? ccAll : undefined,
    threadId: original.threadId,
  })
}

export async function forwardEmail(emailId: string, to: string | string[], note?: string) {
  const { data: original } = await supabase
    .from("Email")
    .select("*, attachments:Attachment(*)")
    .eq("id", emailId)
    .maybeSingle()

  if (!original) throw new Error("Email not found")

  const fwdBody = note
    ? `${note}\n\n---------- Forwarded message ----------\nFrom: ${original.from}\nTo: ${original.to}\nSubject: ${original.subject}\n\n${original.body}`
    : `---------- Forwarded message ----------\nFrom: ${original.from}\nTo: ${original.to}\nSubject: ${original.subject}\n\n${original.body}`

  const fwdHtml = note
    ? `<p>${note}</p><hr><p><b>From:</b> ${original.from}<br><b>To:</b> ${original.to}<br><b>Subject:</b> ${original.subject}</p>${original.html || `<pre>${original.body}</pre>`}`
    : `<hr><p><b>From:</b> ${original.from}<br><b>To:</b> ${original.to}<br><b>Subject:</b> ${original.subject}</p>${original.html || `<pre>${original.body}</pre>`}`

  const attachments = (original.attachments ?? []).map((attachment: unknown) => {
    const item = attachment as { filename?: string; content?: string; contentType?: string }
    return { filename: item.filename ?? "attachment", content: item.content ?? "", type: item.contentType }
  }).filter((attachment: { content: string }) => attachment.content)

  return sendAgentEmail(original.agentId, to, `Fwd: ${original.subject}`, fwdBody, {
    html: fwdHtml,
    attachments: attachments.length ? attachments : undefined,
  })
}

export async function markRead(emailId: string, read = true) {
  const { data } = await supabase
    .from("Email")
    .update({ isRead: read })
    .eq("id", emailId)
    .select()
    .single()
  return data
}

export async function archiveEmail(emailId: string) {
  const { data } = await supabase
    .from("Email")
    .update({ isArchived: true })
    .eq("id", emailId)
    .select()
    .single()
  return data
}

export async function deleteEmail(emailId: string) {
  await supabase.from("Attachment").delete().eq("emailId", emailId)
  const { error } = await supabase.from("Email").delete().eq("id", emailId)
  return !error
}

// ─── INBOUND RECEIVE ──────────────────────────────────────────────────────

export async function receiveEmail(
  toAddress: string,
  from: string,
  subject: string,
  body: string,
  html?: string,
  attachments?: Attachment[]
) {
  const { data: agent } = await supabase
    .from("Agent")
    .select("*")
    .eq("emailAddress", toAddress)
    .maybeSingle()

  if (!agent) throw new Error(`No agent for address: ${toAddress}`)

  // Thread detection
  const { data: existingThread } = await supabase
    .from("Email")
    .select("threadId")
    .eq("agentId", agent.id)
    .or(`and(from.eq.${from},to.eq.${toAddress}),and(from.eq.${toAddress},to.eq.${from})`)
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: email } = await supabase
    .from("Email")
    .insert({
      agentId: agent.id,
      from,
      to: toAddress,
      subject,
      body,
      html: html ?? null,
      direction: "inbound",
      threadId: existingThread?.threadId ?? uuidv4(),
    })
    .select()
    .single()

  // Store inbound attachments
  if (attachments?.length && email) {
    await supabase.from("Attachment").insert(
      attachments.map((a) => ({
        emailId: email.id,
        filename: a.filename,
        contentType: a.type ?? "application/octet-stream",
        size: Math.ceil((a.content.length * 3) / 4),
        content: a.content,
      }))
    )
  }

  // Auto-reply
  if (agent.autoReplyActive && agent.autoReply && email) {
    await sendAgentEmail(agent.id, from, `Re: ${subject}`, agent.autoReply, {
      threadId: email.threadId,
    })
  }

  // Webhook — fire-and-forget with HMAC-SHA256 signature so receivers can verify authenticity.
  if (agent.webhookUrl && email) {
    const payload = JSON.stringify({ event: "email.received", data: email })
    const secret = process.env.WEBHOOK_SECRET
    const sig = secret
      ? `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`
      : undefined
    fetch(agent.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(sig ? { "X-AgentMail-Signature": sig } : {}),
      },
      body: payload,
    }).catch((err) => console.error("[webhook] delivery failed:", agent.webhookUrl, err))
  }

  return email
}

// ─── ANALYTICS ───────────────────────────────────────────────────────────

export async function getEmailStats(userId: string) {
  const { data: agents } = await supabase.from("Agent").select("id").eq("userId", userId)
  const agentIds = (agents ?? []).map((a) => a.id)

  if (agentIds.length === 0) {
    return { totalSent: 0, totalReceived: 0, totalAgents: 0, unreadCount: 0 }
  }

  const [sentRes, receivedRes, agentCountRes, unreadRes] = await Promise.all([
    supabase.from("Email").select("*", { count: "exact", head: true }).in("agentId", agentIds).eq("direction", "outbound"),
    supabase.from("Email").select("*", { count: "exact", head: true }).in("agentId", agentIds).eq("direction", "inbound"),
    supabase.from("Agent").select("*", { count: "exact", head: true }).eq("userId", userId),
    supabase.from("Email").select("*", { count: "exact", head: true }).in("agentId", agentIds).eq("direction", "inbound").eq("isRead", false),
  ])

  return {
    totalSent: sentRes.count ?? 0,
    totalReceived: receivedRes.count ?? 0,
    totalAgents: agentCountRes.count ?? 0,
    unreadCount: unreadRes.count ?? 0,
  }
}
