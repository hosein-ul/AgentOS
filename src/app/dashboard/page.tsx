import Link from "next/link"
import {
  Activity,
  ArrowUpRight,
  Bell,
  Globe,
  KeyRound,
  Mail,
  MessageSquare,
  PhoneCall,
  Plus,
  Zap,
} from "lucide-react"
import { PageContainer, PageHeader, Section } from "@/components/ui/section"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Stat } from "@/components/ui/stat"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { requireDashboardSession } from "@/lib/dashboard-auth"
import { getTenantDashboardData } from "@/lib/dashboard-data"
import { fmtRelative } from "@/lib/utils"

export const dynamic = "force-dynamic"

const ACTIVE_NUMBER_STATES = new Set(["active", "renewal_due", "renewal_authorized"])

export default async function DashboardPage() {
  const session = await requireDashboardSession()
  const data = await getTenantDashboardData(session.tenantId)
  const sent = data.messages.filter((message) => message.direction === "outbound").length
  const received = data.messages.filter((message) => message.direction === "inbound").length
  const activeNumbers = data.numbers.filter((number) => ACTIVE_NUMBER_STATES.has(number.lifecycle_status)).length
  const callMinutes = data.calls.reduce((total, call) => total + Number(call.duration_seconds ?? 0), 0) / 60
  const spend = data.payments.reduce((total, payment) => total + Number(payment.amount ?? 0), 0)
  const pendingEvents = data.events.filter((event) => event.status !== "acknowledged").length
  const activeTokens = data.tokens.filter((token) => !token.revoked_at).length
  const spendByService = new Map<string, { count: number; amount: number }>()
  for (const payment of data.payments) {
    const key = payment.service_id ?? payment.endpoint
    const current = spendByService.get(key) ?? { count: 0, amount: 0 }
    current.count += 1
    current.amount += Number(payment.amount ?? 0)
    spendByService.set(key, current)
  }

  return (
    <PageContainer>
      <PageHeader
        title="Overview"
        description="Live wallet-isolated state across AgentOS email, AgentPhone, durable events, payments, and domains."
        actions={
          <>
            <Button variant="secondary" asChild><Link href="/api/v1" target="_blank"><Activity /> API discovery</Link></Button>
            <Button asChild><Link href="/dashboard/mailboxes"><Plus /> Create resource</Link></Button>
          </>
        }
      />

      {!session.tenantId ? (
        <Card className="border-accent/30 bg-accent-soft p-5">
          <p className="text-sm font-semibold">This wallet is signed in but has no AgentOS tenant yet</p>
          <p className="mt-1 text-xs leading-5 text-text-2">
            Your first paid mailbox or phone-number purchase creates the tenant and binds every future resource to this wallet.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild><Link href="/dashboard/mailboxes">Create mailbox · 0.25 USDT</Link></Button>
            <Button variant="secondary" asChild><Link href="/dashboard/numbers">Buy phone number · 7.00 USDT</Link></Button>
          </div>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Email · last 30 days" value={sent + received} icon={<Mail />} />
  <Stat label="Connected call time · 30 days" value={callMinutes} suffix="min" icon={<PhoneCall />} />
  <Stat label="x402 settled · 30 days" value={spend} suffix="USDT" icon={<Zap />} />
        <Stat label="Pending durable events" value={pendingEvents} icon={<Bell />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ServiceCard
          icon={<Mail />}
          title="Email"
          metric={`${data.mailboxes.length} mailbox${data.mailboxes.length === 1 ? "" : "es"}`}
          detail={`${sent} sent · ${received} received`}
          href="/dashboard/mailboxes"
        />
        <ServiceCard
          icon={<PhoneCall />}
          title="AgentPhone"
          metric={`${activeNumbers} active number${activeNumbers === 1 ? "" : "s"}`}
          detail={`${data.calls.length} calls in 30 days`}
          href="/dashboard/numbers"
        />
        <ServiceCard
          icon={<Globe />}
          title="Domains"
          metric={`${data.domains.length} domain${data.domains.length === 1 ? "" : "s"}`}
          detail="Registration currently fail-closed"
          href="/dashboard/domains"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent messages</CardTitle>
            <CardDescription>Real inbound and outbound email persisted during the last 30 days.</CardDescription>
          </CardHeader>
          <CardContent>
            {data.messages.length === 0 ? (
              <EmptyState icon={<MessageSquare />} title="No email activity" description="Messages appear after real Resend send or inbound webhook events." />
            ) : (
              <div className="divide-y divide-line">
                {data.messages.slice(0, 6).map((message) => (
                  <div key={message.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <Badge variant={message.direction === "inbound" ? "accent" : "outline"}>{message.direction}</Badge>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{message.subject || "(no subject)"}</p>
                      <p className="truncate text-xs text-muted">
                        {message.direction === "inbound" ? message.from_address : message.to_addresses.join(", ")}
                      </p>
                    </div>
                    <span className="text-xs text-muted">{fmtRelative(message.created_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Durable event inbox</CardTitle>
            <CardDescription>WebSocket fallback and lifecycle notifications.</CardDescription>
          </CardHeader>
          <CardContent>
            {data.events.length === 0 ? (
              <EmptyState icon={<Bell />} title="No events" description="Verified service events and renewal reminders will appear here." />
            ) : (
              <div className="divide-y divide-line">
                {data.events.slice(0, 6).map((event) => (
                  <div key={event.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <span className="size-2 rounded-full bg-accent" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-xs font-medium">{event.type}</p>
                      <p className="truncate text-xs text-muted">{event.resource_type ?? "system event"}</p>
                    </div>
                    <Badge variant={event.status === "acknowledged" ? "muted" : "outline"}>{event.status}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>x402 settlement ledger</CardTitle>
            <CardDescription>Actual payments grouped by canonical service ID, last 30 days.</CardDescription>
          </CardHeader>
          <CardContent>
            {spendByService.size === 0 ? (
              <EmptyState icon={<Zap />} title="No settled payments" description="This view never estimates or simulates payment activity." />
            ) : (
              <ul className="space-y-3">
                {[...spendByService].map(([service, row]) => (
                  <li key={service} className="flex items-center gap-3">
                    <code className="min-w-0 flex-1 truncate text-xs">{service}</code>
                    <span className="text-xs text-muted">×{row.count}</span>
                    <span className="font-mono text-sm font-medium">{row.amount.toFixed(2)} USDT</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Agent API access</CardTitle>
            <CardDescription>Permanent bearer tokens for autonomous agents; secrets are only shown once.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4 rounded-lg bg-elevated p-4">
              <div className="grid size-10 place-items-center rounded-lg bg-surface text-text-2"><KeyRound className="size-4" /></div>
              <div className="flex-1">
                <p className="text-sm font-semibold">{activeTokens} active token{activeTokens === 1 ? "" : "s"}</p>
                <p className="text-xs text-muted">Bound to this wallet tenant</p>
              </div>
              <Button variant="secondary" asChild><Link href="/dashboard/api-keys">Manage tokens</Link></Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Section title="Quick links">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" asChild><Link href="/dashboard/events">Open events <ArrowUpRight /></Link></Button>
          <Button variant="secondary" asChild><Link href="/dashboard/guide">Agent integration guide <ArrowUpRight /></Link></Button>
        </div>
      </Section>
    </PageContainer>
  )
}

function ServiceCard({
  icon,
  title,
  metric,
  detail,
  href,
}: {
  icon: React.ReactNode
  title: string
  metric: string
  detail: string
  href: string
}) {
  return (
    <Card className="flex items-center gap-4 p-5">
      <div className="grid size-11 place-items-center rounded-xl bg-elevated text-text-2 [&_svg]:size-5">{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-muted">{title}</p>
        <p className="mt-0.5 text-base font-semibold">{metric}</p>
        <p className="mt-0.5 truncate text-xs text-text-2">{detail}</p>
      </div>
      <Button variant="ghost" size="icon-sm" asChild>
        <Link href={href} aria-label={`Open ${title}`}><ArrowUpRight /></Link>
      </Button>
    </Card>
  )
}
