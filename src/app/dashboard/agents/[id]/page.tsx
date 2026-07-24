"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"

interface Email {
  id: string
  from: string
  to: string
  subject: string
  body: string
  html?: string
  direction: string
  isRead: boolean
  threadId?: string
  createdAt: string
}

interface Agent {
  id: string
  name: string
  emailAddress: string
  isActive: boolean
  webhookUrl: string | null
  createdAt: string
  emails: Email[]
  _count: { emails: number }
}

function formatDate(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  if (isToday) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  return d.toLocaleDateString([], { month: "short", day: "numeric" })
}

export default function AgentDetailPage() {
  const params = useParams()
  const [agent, setAgent] = useState<Agent | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Email | null>(null)
  const [composing, setComposing] = useState(false)
  const [composeTo, setComposeTo] = useState("")
  const [composeSubject, setComposeSubject] = useState("")
  const [composeBody, setComposeBody] = useState("")
  const [sending, setSending] = useState(false)
  const toRef = useRef<HTMLInputElement>(null)

  const fetchAgent = useCallback(() => {
    fetch(`/api/agents/${params.id}`)
      .then((r) => r.json())
      .then((d) => { if (d.agent) setAgent(d.agent) })
      .finally(() => setLoading(false))
  }, [params.id])

  useEffect(() => { fetchAgent() }, [fetchAgent])

  const handleSend = async () => {
    if (!composeTo || !composeSubject || !composeBody) return
    setSending(true)
    await fetch("/api/emails/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: params.id, to: composeTo, subject: composeSubject, body: composeBody }),
    })
    setComposeTo(""); setComposeSubject(""); setComposeBody("")
    setComposing(false)
    setSending(false)
    fetchAgent()
  }

  const openCompose = () => {
    setComposing(true)
    setSelected(null)
    setTimeout(() => toRef.current?.focus(), 50)
  }

  if (loading) {
    return (
      <div className="flex h-full">
        <div className="w-72 border-r border-line animate-pulse p-4 space-y-3">
          {[...Array(5)].map((_, i) => <div key={i} className="h-14 bg-surface-sub rounded" />)}
        </div>
        <div className="flex-1 p-8">
          <div className="h-6 bg-surface-sub rounded w-48 mb-4" />
          <div className="h-4 bg-surface-sub rounded w-32" />
        </div>
      </div>
    )
  }

  if (!agent) {
    return (
      <div className="flex items-center justify-center h-full text-ink-2">
        <div className="text-center">
          <p className="mb-2">Agent not found</p>
          <Link href="/dashboard/agents" className="text-sm text-amber hover:text-amber-h">← Back</Link>
        </div>
      </div>
    )
  }

  const unreadCount = agent.emails.filter(e => !e.isRead && e.direction === "inbound").length

  return (
    <div className="flex h-full overflow-hidden">
      {/* Email list pane */}
      <div className="w-72 border-r border-line flex flex-col shrink-0">
        {/* Pane header */}
        <div className="border-b border-line px-4 py-3">
          <div className="flex items-center justify-between mb-0.5">
            <Link href="/dashboard/agents" className="text-xs text-ink-3 hover:text-ink transition-colors">
              ← Agents
            </Link>
            <button
              onClick={openCompose}
              className="text-xs px-2.5 py-1 bg-amber text-white rounded hover:bg-amber-h transition-colors"
            >
              Compose
            </button>
          </div>
          <p className="text-sm font-medium mt-2 truncate">{agent.name}</p>
          <p className="text-xs font-mono text-ink-3 truncate">{agent.emailAddress}</p>
          {unreadCount > 0 && (
            <p className="text-xs text-amber mt-1">{unreadCount} unread</p>
          )}
        </div>

        {/* Email list */}
        <div className="flex-1 overflow-y-auto divide-y divide-line">
          {agent.emails.length === 0 ? (
            <div className="p-6 text-center">
              <p className="text-sm text-ink-3">No emails yet</p>
              <button onClick={openCompose} className="text-xs text-amber hover:text-amber-h mt-2 transition-colors">
                Compose first email
              </button>
            </div>
          ) : (
            agent.emails.map((email) => {
              const isSelected = selected?.id === email.id
              const isUnread = !email.isRead && email.direction === "inbound"
              const contact = email.direction === "inbound" ? email.from : email.to
              const contactName = contact.split("@")[0]

              return (
                <button
                  key={email.id}
                  onClick={() => { setSelected(email); setComposing(false) }}
                  className={`w-full text-left px-4 py-3 transition-colors ${
                    isSelected ? "bg-amber-bg" : "hover:bg-surface-sub"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-0.5">
                    <span className={`text-sm truncate ${isUnread ? "font-medium text-ink" : "text-ink-2"}`}>
                      {contactName}
                    </span>
                    <span className="text-xs text-ink-3 shrink-0 mt-0.5">{formatDate(email.createdAt)}</span>
                  </div>
                  <p className={`text-xs truncate mb-0.5 ${isUnread ? "text-ink" : "text-ink-2"}`}>
                    {email.subject}
                  </p>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-mono ${email.direction === "inbound" ? "text-green" : "text-ink-3"}`}>
                      {email.direction === "inbound" ? "↓" : "↑"}
                    </span>
                    {isUnread && <span className="w-1.5 h-1.5 rounded-full bg-amber shrink-0" />}
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* Reader / compose pane */}
      <div className="flex-1 overflow-y-auto">
        {composing ? (
          <div className="max-w-2xl mx-auto px-8 py-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-sm font-medium">New message</h2>
              <button onClick={() => setComposing(false)} className="text-xs text-ink-3 hover:text-ink transition-colors">
                Discard
              </button>
            </div>

            <div className="border border-line rounded divide-y divide-line">
              <div className="flex items-center px-4 py-3 gap-3">
                <span className="text-xs text-ink-3 w-12 shrink-0">From</span>
                <span className="text-sm font-mono text-ink-2">{agent.emailAddress}</span>
              </div>
              <div className="flex items-center px-4 py-3 gap-3">
                <span className="text-xs text-ink-3 w-12 shrink-0">To</span>
                <input
                  ref={toRef}
                  type="email"
                  value={composeTo}
                  onChange={(e) => setComposeTo(e.target.value)}
                  placeholder="recipient@example.com"
                  className="flex-1 text-sm bg-transparent text-ink placeholder:text-ink-3 outline-none"
                />
              </div>
              <div className="flex items-center px-4 py-3 gap-3">
                <span className="text-xs text-ink-3 w-12 shrink-0">Subject</span>
                <input
                  type="text"
                  value={composeSubject}
                  onChange={(e) => setComposeSubject(e.target.value)}
                  placeholder="Subject"
                  className="flex-1 text-sm bg-transparent text-ink placeholder:text-ink-3 outline-none"
                />
              </div>
              <div className="px-4 py-3">
                <textarea
                  value={composeBody}
                  onChange={(e) => setComposeBody(e.target.value)}
                  placeholder="Write your message…"
                  rows={12}
                  className="w-full text-sm bg-transparent text-ink placeholder:text-ink-3 outline-none resize-none leading-relaxed"
                />
              </div>
            </div>

            <div className="flex items-center gap-3 mt-4">
              <button
                onClick={handleSend}
                disabled={sending || !composeTo || !composeSubject || !composeBody}
                className="px-4 py-2 bg-amber text-white text-sm font-medium rounded hover:bg-amber-h transition-colors disabled:opacity-40"
              >
                {sending ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        ) : selected ? (
          <div className="max-w-2xl mx-auto px-8 py-8">
            {/* Email header */}
            <div className="mb-6">
              <h2 className="text-xl font-serif mb-4">{selected.subject}</h2>
              <div className="text-sm text-ink-2 space-y-1">
                <div className="flex gap-3">
                  <span className="text-ink-3 w-8 shrink-0">From</span>
                  <span>{selected.from}</span>
                </div>
                <div className="flex gap-3">
                  <span className="text-ink-3 w-8 shrink-0">To</span>
                  <span>{selected.to}</span>
                </div>
                <div className="flex gap-3">
                  <span className="text-ink-3 w-8 shrink-0">Date</span>
                  <span>{new Date(selected.createdAt).toLocaleString()}</span>
                </div>
              </div>
            </div>

            <div className="border-t border-line pt-6">
              {selected.html ? (
                <div
                  className="text-sm text-ink leading-relaxed prose max-w-none"
                  dangerouslySetInnerHTML={{ __html: selected.html }}
                />
              ) : (
                <pre className="text-sm text-ink leading-relaxed whitespace-pre-wrap font-sans">
                  {selected.body}
                </pre>
              )}
            </div>

            {/* Quick reply */}
            <div className="mt-8 pt-6 border-t border-line">
              <button
                onClick={() => {
                  setComposeTo(selected.from)
                  setComposeSubject(`Re: ${selected.subject}`)
                  setComposing(true)
                }}
                className="text-sm text-amber hover:text-amber-h transition-colors"
              >
                Reply ↑
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-ink-3">
            <div className="text-center">
              <p className="text-sm">Select an email to read</p>
              <button onClick={openCompose} className="text-xs text-amber hover:text-amber-h mt-2 transition-colors">
                or compose a new message
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
