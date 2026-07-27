"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Mail, Plus, Send, X, ChevronRight } from "lucide-react"
import { PageContainer, PageHeader, Section } from "@/components/ui/section"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { paidDashboardPost } from "@/lib/browser-x402"
import { responseData } from "@/lib/dashboard-client"

type Mailbox = {
  id: string
  email_address: string
  display_name: string | null
  active: boolean
  created_at: string
}

type Message = {
  id: string
  mailbox_id: string
  direction: string
  from_address: string
  to_addresses: string[]
  subject: string
  status: string
  created_at: string
}

type MessageDetail = Message & {
  text_body?: string | null
  html_body?: string | null
}

type MailboxManagerProps = {
  initialMailboxes: Mailbox[]
  initialMessages: Message[]
}

export function MailboxManager({ initialMailboxes, initialMessages }: MailboxManagerProps) {
  const router = useRouter()
  const [mode, setMode] = useState<"create" | "compose" | null>(null)
  const [localPart, setLocalPart] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [mailboxId, setMailboxId] = useState(initialMailboxes[0]?.id ?? "")
  const [to, setTo] = useState("")
  const [subject, setSubject] = useState("")
  const [text, setText] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<MessageDetail | null>(null)

  async function runPaid(serviceId: string, input: Record<string, unknown>) {
    setPending(true)
    setError(null)
    try {
      const response = await paidDashboardPost(serviceId, input)
      await responseData(response)
      setMode(null)
      router.refresh()
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The operation failed")
      return false
    } finally {
      setPending(false)
    }
  }

  async function createMailbox() {
    if (!localPart.trim()) return
    if (await runPaid("email.mailbox.create", {
      localPart: localPart.trim(),
      displayName: displayName.trim() || undefined,
    })) {
      setLocalPart("")
      setDisplayName("")
    }
  }

  async function sendMessage() {
    const recipients = to.split(",").map((value) => value.trim()).filter(Boolean)
    if (!mailboxId || recipients.length === 0 || !subject.trim() || !text.trim()) return
    if (await runPaid("email.message.send", {
      mailboxId,
      to: recipients,
      subject: subject.trim(),
      text,
    })) {
      setTo("")
      setSubject("")
      setText("")
    }
  }

  async function openMessage(messageId: string) {
    setError(null)
    try {
      const response = await fetch(`/api/dashboard/messages/${encodeURIComponent(messageId)}`)
      setSelected(await responseData<MessageDetail>(response))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Message could not be loaded")
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title="Email"
        description="Create mailboxes, send real email through Resend, and read your tenant-isolated inbox."
        actions={
          <>
            <Button variant="secondary" onClick={() => setMode("compose")} disabled={!initialMailboxes.length}>
              <Send /> Send email · 0.02 USDT
            </Button>
            <Button onClick={() => setMode("create")}>
              <Plus /> New mailbox · 0.25 USDT
            </Button>
          </>
        }
      />

      {error ? (
        <Card role="alert" className="border-negative/30 bg-negative-soft p-4 text-sm text-negative">
          {error}
        </Card>
      ) : null}

      {mode === "create" ? (
        <Card className="p-5">
          <PanelHeading title="Create a mailbox" onClose={() => setMode(null)} />
          <p className="mt-1 text-xs text-muted">A real one-time x402 payment is requested before provisioning.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Mailbox name">
              <Input value={localPart} onChange={(event) => setLocalPart(event.target.value.toLowerCase())} placeholder="support" />
            </Field>
            <Field label="Display name">
              <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Support Agent" />
            </Field>
          </div>
          <div className="mt-4 flex gap-2">
            <Button onClick={createMailbox} disabled={pending || !localPart.trim()}>
              {pending ? "Confirm in wallet…" : "Pay 0.25 USDT and create"}
            </Button>
            <Button variant="secondary" onClick={() => setMode(null)} disabled={pending}>Cancel</Button>
          </div>
        </Card>
      ) : null}

      {mode === "compose" ? (
        <Card className="p-5">
          <PanelHeading title="Send email" onClose={() => setMode(null)} />
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="From mailbox">
              <select
                value={mailboxId}
                onChange={(event) => setMailboxId(event.target.value)}
                className="h-9 w-full rounded-md border border-line bg-surface px-3 text-sm"
              >
                {initialMailboxes.filter((mailbox) => mailbox.active).map((mailbox) => (
                  <option key={mailbox.id} value={mailbox.id}>{mailbox.email_address}</option>
                ))}
              </select>
            </Field>
            <Field label="To (comma separated)">
              <Input value={to} onChange={(event) => setTo(event.target.value)} placeholder="person@example.com" />
            </Field>
          </div>
          <Field label="Subject" className="mt-4">
            <Input value={subject} onChange={(event) => setSubject(event.target.value)} />
          </Field>
          <Field label="Plain-text message" className="mt-4">
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={7}
              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm"
            />
          </Field>
          <div className="mt-4 flex gap-2">
            <Button
              onClick={sendMessage}
              disabled={pending || !mailboxId || !to.trim() || !subject.trim() || !text.trim()}
            >
              {pending ? "Confirm in wallet…" : "Pay 0.02 USDT and send"}
            </Button>
            <Button variant="secondary" onClick={() => setMode(null)} disabled={pending}>Cancel</Button>
          </div>
        </Card>
      ) : null}

      <Section title="Mailboxes" description="Only resources owned by the signed-in wallet are shown.">
        <Card className="overflow-hidden">
          {initialMailboxes.length === 0 ? (
            <EmptyState
              icon={<Mail />}
              title="No mailboxes yet"
              description="Create your first real mailbox. No resource is created until its x402 payment settles."
              action={<Button onClick={() => setMode("create")}><Plus /> Create mailbox</Button>}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-[.06em] text-muted">
                    <th className="px-5 py-3">Address</th>
                    <th className="px-5 py-3">Display name</th>
                    <th className="px-5 py-3">Created</th>
                    <th className="px-5 py-3 text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {initialMailboxes.map((mailbox) => (
                    <tr key={mailbox.id} className="border-b border-line last:border-0 hover:bg-elevated/50">
                      <td className="px-5 py-3 font-mono text-text">{mailbox.email_address}</td>
                      <td className="px-5 py-3 text-text-2">{mailbox.display_name ?? "—"}</td>
                      <td className="px-5 py-3 text-text-2">{new Date(mailbox.created_at).toLocaleDateString()}</td>
                      <td className="px-5 py-3 text-right">
                        <Badge dot variant={mailbox.active ? "positive" : "muted"}>
                          {mailbox.active ? "Active" : "Disabled"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </Section>

      <Section title="Messages · last 30 days" description="Inbound and outbound messages persisted by AgentOS.">
        <Card className="overflow-hidden">
          {initialMessages.length === 0 ? (
            <EmptyState icon={<Mail />} title="No messages yet" description="Sent and received email will appear here." />
          ) : (
            <div className="divide-y divide-line">
              {initialMessages.map((message) => (
                <button
                  key={message.id}
                  type="button"
                  onClick={() => openMessage(message.id)}
                  className="flex w-full items-center gap-4 px-5 py-3 text-left hover:bg-elevated/50"
                >
                  <Badge variant={message.direction === "inbound" ? "accent" : "outline"}>{message.direction}</Badge>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-text">{message.subject || "(no subject)"}</p>
                    <p className="truncate text-xs text-muted">
                      {message.direction === "inbound" ? message.from_address : message.to_addresses.join(", ")}
                    </p>
                  </div>
                  <time className="hidden text-xs text-muted sm:block">{new Date(message.created_at).toLocaleString()}</time>
                  <ChevronRight className="size-4 text-muted" />
                </button>
              ))}
            </div>
          )}
        </Card>
      </Section>

      {selected ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <Card className="max-h-[85vh] w-full max-w-2xl overflow-y-auto p-5 shadow-token-lg">
            <PanelHeading title={selected.subject || "(no subject)"} onClose={() => setSelected(null)} />
            <dl className="mt-4 grid gap-2 text-xs text-text-2">
              <div><dt className="inline font-medium text-text">From: </dt><dd className="inline">{selected.from_address}</dd></div>
              <div><dt className="inline font-medium text-text">To: </dt><dd className="inline">{selected.to_addresses.join(", ")}</dd></div>
              <div><dt className="inline font-medium text-text">Time: </dt><dd className="inline">{new Date(selected.created_at).toLocaleString()}</dd></div>
            </dl>
            <pre className="mt-5 whitespace-pre-wrap rounded-lg bg-elevated p-4 font-sans text-sm leading-6 text-text">
              {selected.text_body || (selected.html_body ? "This message contains HTML. Use the AgentOS API to retrieve the original HTML body." : "No message body was stored.")}
            </pre>
          </Card>
        </div>
      ) : null}
    </PageContainer>
  )
}

function PanelHeading({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-base font-semibold">{title}</h2>
      <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close panel"><X /></Button>
    </div>
  )
}

function Field({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <label className={className}>
      <span className="mb-1.5 block text-xs font-medium text-text-2">{label}</span>
      {children}
    </label>
  )
}
