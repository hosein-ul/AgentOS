"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { motion } from "framer-motion"
import {
  Mail, PhoneCall, Globe, ArrowUpRight, Plus, Zap,
  MessageSquare, Timer, Activity,
} from "lucide-react"
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid,
} from "recharts"

import { PageContainer, PageHeader, Section } from "@/components/ui/section"
import { Stat } from "@/components/ui/stat"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { fmtCompact, fmtRelative, fmtUsd } from "@/lib/utils"

interface Stats {
  totalSent: number
  totalReceived: number
  totalAgents: number
  unreadCount: number
  dailyStats: Record<string, { sent: number; received: number }>
  agentStats: Array<{
    id: string
    name: string
    emailAddress: string
    totalEmails: number
    isActive: boolean
  }>
  phone: {
    totalNumbers: number
    activeNumbers: number
    callsLast7Days: number
    minutesLast7Days: number
  }
  domains: { total: number; active: number }
  payments: {
    totalLast7Days: number
    byService: Array<{ label: string; count: number; total: number }>
  }
  recentEvents: Array<{
    type: string
    payload: Record<string, unknown>
    created_at: string
  }>
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/analytics")
      .then((r) => r.json())
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setLoading(false))
  }, [])

  const daily = stats?.dailyStats
    ? Object.entries(stats.dailyStats)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, d]) => ({
          date,
          label: new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
          Sent: d.sent,
          Received: d.received,
        }))
    : []

  const sentTrend = daily.slice(-7).map((d) => d.Sent)
  const receivedTrend = daily.slice(-7).map((d) => d.Received)

  return (
    <PageContainer>
      <PageHeader
        title="Overview"
        description="Real-time activity across every service your agents use — email, phone, and domain."
        actions={
          <>
            <Button variant="secondary" size="md" asChild>
              <Link href="/api/v1" target="_blank">
                <Activity /> API status
              </Link>
            </Button>
            <Button size="md" asChild>
              <Link href="/dashboard/mailboxes">
                <Plus /> New agent
              </Link>
            </Button>
          </>
        }
      />

      {/* Top stat grid */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
      >
        {loading ? (
          <>
            <Skeleton className="h-[132px]" />
            <Skeleton className="h-[132px]" />
            <Skeleton className="h-[132px]" />
            <Skeleton className="h-[132px]" />
          </>
        ) : (
          <>
            <Stat
              label="Emails sent"
              value={stats?.totalSent ?? 0}
              delta={9.8}
              trend={sentTrend.length ? sentTrend : [4, 6, 5, 8, 9, 7, 12]}
              icon={<Mail />}
            />
            <Stat
              label="Emails received"
              value={stats?.totalReceived ?? 0}
              delta={3.2}
              trend={receivedTrend.length ? receivedTrend : [2, 3, 3, 4, 3, 5, 4]}
              icon={<MessageSquare />}
            />
            <Stat
              label="Calls this week"
              value={stats?.phone.minutesLast7Days ?? 0}
              format={(n) => n.toFixed(1)}
              suffix="min"
              icon={<PhoneCall />}
            />
            <Stat
              label="x402 settled · 7 days"
              value={stats?.payments.totalLast7Days ?? 0}
              format={(n) => n.toFixed(4)}
              suffix="USDT"
              icon={<Zap />}
            />
          </>
        )}
      </motion.div>

      {/* Activity chart + services */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Activity</CardTitle>
              <CardDescription>Last 30 days across sends and receives.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge dot variant="accent">Sent</Badge>
              <Badge dot variant="positive">Received</Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            {loading ? (
              <Skeleton className="h-[220px]" />
            ) : daily.length === 0 ? (
              <EmptyState
                icon={<Activity />}
                title="No activity yet"
                description="Once your agents start sending or receiving mail, the last 30 days show up here."
              />
            ) : (
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={daily} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gSent" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.28} />
                        <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gRecv" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="var(--positive)" stopOpacity={0.22} />
                        <stop offset="100%" stopColor="var(--positive)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="0" />
                    <XAxis
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                      tickFormatter={(v) => fmtCompact(Number(v))}
                    />
                    <RTooltip
                      cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
                      contentStyle={{
                        background: "var(--surface)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        fontSize: 12,
                        color: "var(--text)",
                        boxShadow: "var(--shadow-md)",
                      }}
                      labelStyle={{ color: "var(--text-muted)", fontSize: 11, marginBottom: 4 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="Sent"
                      stroke="var(--accent)"
                      strokeWidth={2}
                      fill="url(#gSent)"
                    />
                    <Area
                      type="monotone"
                      dataKey="Received"
                      stroke="var(--positive)"
                      strokeWidth={2}
                      fill="url(#gRecv)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Services quick summary */}
        <div className="flex flex-col gap-4">
          <ServiceCard
            icon={<Mail />}
            title="Email"
            total={stats?.totalAgents ?? 0}
            unit="mailboxes"
            statLine={`${stats?.unreadCount ?? 0} unread`}
            href="/dashboard/mailboxes"
          />
          <ServiceCard
            icon={<PhoneCall />}
            title="Phone"
            total={stats?.phone.totalNumbers ?? 0}
            unit="numbers"
            statLine={`${stats?.phone.callsLast7Days ?? 0} calls in 7 days`}
            href="/dashboard/numbers"
          />
          <ServiceCard
            icon={<Globe />}
            title="Domains"
            total={stats?.domains.total ?? 0}
            unit="domains"
            statLine={`${stats?.domains.active ?? 0} active`}
            href="/dashboard/domains"
          />
        </div>
      </div>

      {/* Mailboxes table */}
      <Section
        title="Recent mailboxes"
        description="Agents grouped by activity in the last 30 days."
        actions={
          <Button variant="ghost" size="sm" asChild>
            <Link href="/dashboard/mailboxes">
              View all <ArrowUpRight />
            </Link>
          </Button>
        }
      >
        <Card className="overflow-hidden">
          {loading ? (
            <div className="p-5 flex flex-col gap-2">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : (stats?.agentStats?.length ?? 0) === 0 ? (
            <EmptyState
              icon={<Mail />}
              title="No mailboxes yet"
              description="Create your first agent mailbox to start sending and receiving email through the API."
              action={
                <Button asChild>
                  <Link href="/dashboard/mailboxes">
                    <Plus /> Create mailbox
                  </Link>
                </Button>
              }
            />
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-[0.06em] text-muted">
                  <th className="text-left font-medium px-5 py-2.5">Agent</th>
                  <th className="text-left font-medium px-5 py-2.5">Address</th>
                  <th className="text-right font-medium px-5 py-2.5">Emails</th>
                  <th className="text-right font-medium px-5 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {(stats?.agentStats ?? []).slice(0, 6).map((a) => (
                  <tr key={a.id} className="border-b border-line last:border-0 hover:bg-elevated/50 transition-colors">
                    <td className="px-5 py-2.5 text-text font-medium">{a.name}</td>
                    <td className="px-5 py-2.5 text-text-2 font-mono tabular">{a.emailAddress}</td>
                    <td className="px-5 py-2.5 text-right tabular text-text">{fmtCompact(a.totalEmails)}</td>
                    <td className="px-5 py-2.5 text-right">
                      <Badge dot variant={a.isActive ? "positive" : "muted"}>
                        {a.isActive ? "Active" : "Paused"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </Section>

      {/* Recent activity + spend detail */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>x402 spend detail</CardTitle>
            <CardDescription>Per-call payments settled on X Layer, last 7 days.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2.5">
              {(stats?.payments.byService ?? []).slice(0, 8).map((row) => (
                <li key={row.label} className="flex items-center gap-3">
                  <Badge variant="outline">{row.label}</Badge>
                  <span className="text-[12px] text-muted">×{row.count}</span>
                  <span className="ml-auto font-mono tabular text-[13px] text-text">
                    {fmtUsd(row.total)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Live signals</CardTitle>
            <CardDescription>The last 5 events across your tenants.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-3">
              {(stats?.recentEvents ?? []).map((row, i) => (
                <li key={i} className="flex items-start gap-3 pb-3 last:pb-0 border-b border-line last:border-0">
                  <span className="mt-1 size-1.5 rounded-full bg-accent shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] text-text truncate">
                      {String(row.payload.phoneNumber ?? row.payload.phoneNumberId ?? row.payload.callId ?? row.type)}
                    </div>
                    <div className="text-[11.5px] text-muted flex items-center gap-1.5 mt-0.5">
                      <span className="font-mono">{row.type}</span>
                    </div>
                  </div>
                  <span className="text-[11px] text-muted flex items-center gap-1 shrink-0">
                    <Timer className="size-3" />
                    {fmtRelative(row.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}

function ServiceCard({
  icon, title, total, unit, statLine, href,
}: {
  icon: React.ReactNode
  title: string
  total: number
  unit: string
  statLine: string
  href: string
}) {
  return (
    <Card className="p-4 flex items-center gap-4 hover:border-line-strong transition-colors">
      <div className="size-10 rounded-lg bg-elevated grid place-items-center text-text-2 [&_svg]:size-4 shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[18px] font-semibold tabular text-text">{total}</span>
          <span className="text-[11.5px] text-muted">{unit}</span>
        </div>
        <div className="text-[12px] text-text-2 mt-0.5">
          <span className="font-medium text-text">{title}</span>
          <span className="text-muted"> · {statLine}</span>
        </div>
      </div>
      <Button variant="ghost" size="icon-sm" asChild>
        <Link href={href} aria-label={`Go to ${title}`}>
          <ArrowUpRight />
        </Link>
      </Button>
    </Card>
  )
}
