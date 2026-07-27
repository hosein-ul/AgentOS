"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Bell, CheckCheck } from "lucide-react"
import { PageContainer, PageHeader } from "@/components/ui/section"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { dashboardAction } from "@/lib/dashboard-client"

type EventRow = {
  id: string
  type: string
  resource_type: string | null
  resource_id: string | null
  payload: Record<string, unknown>
  status: string
  created_at: string
}

export function EventManager({ initialEvents }: { initialEvents: EventRow[] }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const unacknowledged = initialEvents.filter((event) => event.status !== "acknowledged")

  async function acknowledge(eventId: string) {
    setPending(true)
    setError(null)
    try {
      await dashboardAction({ action: "event.ack", eventId })
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Event could not be acknowledged")
    } finally {
      setPending(false)
    }
  }

  async function acknowledgeAll() {
    setPending(true)
    setError(null)
    try {
      await dashboardAction({
        action: "event.ack-all",
        before: new Date().toISOString(),
      })
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Events could not be acknowledged")
    } finally {
      setPending(false)
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title="Events & notifications"
        description="Durable tenant inbox. WebSocket delivery is immediate while online; pending events remain here and replay after reconnect."
        actions={
          <Button variant="secondary" onClick={acknowledgeAll} disabled={pending || unacknowledged.length === 0}>
            <CheckCheck /> Acknowledge all
          </Button>
        }
      />
      {error ? <Card role="alert" className="border-negative/30 bg-negative-soft p-4 text-sm text-negative">{error}</Card> : null}
      <Card className="overflow-hidden">
        {initialEvents.length === 0 ? (
          <EmptyState
            icon={<Bell />}
            title="No events yet"
            description="Renewal notices, incoming email, call changes, and payment lifecycle events will appear here."
          />
        ) : (
          <div className="divide-y divide-line">
            {initialEvents.map((event) => (
              <article key={event.id} className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="text-xs font-semibold text-text">{event.type}</code>
                    <Badge dot variant={event.status === "acknowledged" ? "muted" : "accent"}>{event.status}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-text-2">
                    {event.resource_type ?? "event"}
                    {event.resource_id ? ` · ${event.resource_id}` : ""}
                  </p>
                  <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted">
                    {event.payload.message
                      ? String(event.payload.message)
                      : JSON.stringify(event.payload)}
                  </p>
                </div>
                <div className="flex items-center gap-3 md:justify-end">
                  <time className="text-xs text-muted">{new Date(event.created_at).toLocaleString()}</time>
                  {event.status !== "acknowledged" ? (
                    <Button variant="secondary" size="sm" onClick={() => acknowledge(event.id)} disabled={pending}>
                      Acknowledge
                    </Button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </Card>
    </PageContainer>
  )
}
