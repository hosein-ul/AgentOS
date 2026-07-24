import { NextResponse } from "next/server"
import { requireServerSupabase } from "@/lib/supabase"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const db = requireServerSupabase()
    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const [
      messages,
      mailboxes,
      calls,
      numbers,
      domains,
      payments,
      events,
    ] = await Promise.all([
      db.from("v1_messages").select("mailbox_id,direction,created_at").gte("created_at", thirtyDaysAgo),
      db.from("v1_mailboxes").select("id,email_address,display_name,active,created_at"),
      db.from("v1_calls").select("id,duration_seconds,status").gte("created_at", sevenDaysAgo),
      db.from("v1_phone_numbers").select("id,lifecycle_status"),
      db.from("v1_domains").select("id,status,expires_at"),
      db.from("v1_payments").select("service_id,endpoint,amount,currency,created_at").gte("created_at", sevenDaysAgo),
      db.from("v1_events").select("type,payload,created_at").order("created_at", { ascending: false }).limit(5),
    ])
    for (const result of [messages, mailboxes, calls, numbers, domains, payments, events]) {
      if (result.error) throw new Error(result.error.message)
    }

    const dailyStats: Record<string, { sent: number; received: number }> = {}
    for (let day = 29; day >= 0; day -= 1) {
      const date = new Date(now.getTime() - day * 24 * 60 * 60 * 1000)
      dailyStats[date.toISOString().slice(0, 10)] = { sent: 0, received: 0 }
    }
    for (const message of messages.data ?? []) {
      const key = message.created_at.slice(0, 10)
      if (!dailyStats[key]) continue
      if (message.direction === "outbound") dailyStats[key].sent += 1
      else dailyStats[key].received += 1
    }

    const sent = (messages.data ?? []).filter((message) => message.direction === "outbound").length
    const received = (messages.data ?? []).filter((message) => message.direction === "inbound").length
    const mailboxMessageCounts = (messages.data ?? []).reduce<Record<string, number>>((counts, message) => {
      counts[message.mailbox_id] = (counts[message.mailbox_id] ?? 0) + 1
      return counts
    }, {})
    const paymentRows = payments.data ?? []
    const paymentTotal = paymentRows.reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0)
    const spendByService = Object.values(paymentRows.reduce<Record<string, { label: string; count: number; total: number }>>(
      (grouped, payment) => {
        const label = payment.service_id || payment.endpoint || "unknown"
        grouped[label] ??= { label, count: 0, total: 0 }
        grouped[label].count += 1
        grouped[label].total += Number(payment.amount ?? 0)
        return grouped
      },
      {},
    )).sort((left, right) => right.total - left.total)

    return NextResponse.json({
      totalSent: sent,
      totalReceived: received,
      totalAgents: mailboxes.data?.length ?? 0,
      unreadCount: 0,
      dailyStats,
      agentStats: (mailboxes.data ?? []).map((mailbox) => ({
        id: mailbox.id,
        name: mailbox.display_name || mailbox.email_address.split("@")[0],
        emailAddress: mailbox.email_address,
        totalEmails: mailboxMessageCounts[mailbox.id] ?? 0,
        isActive: mailbox.active,
      })),
      phone: {
        totalNumbers: numbers.data?.length ?? 0,
        activeNumbers: (numbers.data ?? []).filter((number) =>
          ["active", "renewal_due", "renewal_authorized"].includes(number.lifecycle_status)
        ).length,
        callsLast7Days: calls.data?.length ?? 0,
        minutesLast7Days: (calls.data ?? []).reduce(
          (sum, call) => sum + Number(call.duration_seconds ?? 0),
          0,
        ) / 60,
      },
      domains: {
        total: domains.data?.length ?? 0,
        active: (domains.data ?? []).filter((domain) => domain.status === "active").length,
      },
      payments: {
        totalLast7Days: paymentTotal,
        byService: spendByService,
      },
      recentEvents: events.data ?? [],
    }, {
      headers: { "cache-control": "private, no-store" },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Dashboard data unavailable" },
      { status: 503 },
    )
  }
}
