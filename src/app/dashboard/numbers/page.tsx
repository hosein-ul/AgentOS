import Link from "next/link"
import { PhoneCall, PhoneIncoming, PhoneOutgoing, BookOpen } from "lucide-react"
import { PageContainer, PageHeader, Section } from "@/components/ui/section"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { Stat } from "@/components/ui/stat"
import { requireServerSupabase } from "@/lib/supabase"
import { fmtRelative } from "@/lib/utils"

export const dynamic = "force-dynamic"

type NumberRow = {
  id: string
  phone_number: string
  country: string | null
  provider: string
  lifecycle_status: string
  entitlement_expires_at: string | null
  inbound_seconds_balance: number
  created_at: string
}

type CallRow = {
  id: string
  direction: "inbound" | "outbound"
  from_number: string | null
  to_number: string | null
  status: string
  duration_seconds: number | null
  started_at: string | null
  created_at: string
}

async function phoneData() {
  const db = requireServerSupabase()
  const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const [numbersResult, callsResult] = await Promise.all([
    db
      .from("v1_phone_numbers")
      .select("id,phone_number,country,provider,lifecycle_status,entitlement_expires_at,inbound_seconds_balance,created_at")
      .order("created_at", { ascending: false })
      .limit(250),
    db
      .from("v1_calls")
      .select("id,direction,from_number,to_number,status,duration_seconds,started_at,created_at")
      .gte("created_at", weekStart)
      .order("created_at", { ascending: false })
      .limit(250),
  ])
  if (numbersResult.error) throw new Error(numbersResult.error.message)
  if (callsResult.error) throw new Error(callsResult.error.message)
  return {
    numbers: (numbersResult.data ?? []) as NumberRow[],
    calls: (callsResult.data ?? []) as CallRow[],
  }
}

export default async function NumbersPage() {
  let numbers: NumberRow[] = []
  let calls: CallRow[] = []
  let loadError: string | null = null
  try {
    const data = await phoneData()
    numbers = data.numbers
    calls = data.calls
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Phone data could not be loaded"
  }

  const activeStates = new Set(["active", "renewal_due", "renewal_authorized"])
  const activeNumbers = numbers.filter((number) => activeStates.has(number.lifecycle_status))
  const totalMinutes = calls.reduce((sum, call) => sum + Number(call.duration_seconds ?? 0), 0) / 60

  return (
    <PageContainer>
      <PageHeader
        title="AgentPhone operations"
        description="Private owner view of real numbers, entitlements, inbound balances, and provider call state."
        actions={
          <Button size="md" asChild>
            <Link href="/docs#phone">
              <BookOpen /> Agent guide
            </Link>
          </Button>
        }
      />

      {loadError ? (
        <Card className="border-negative/30 bg-negative/5 p-5">
          <p className="text-sm font-medium text-negative">Phone data is unavailable</p>
          <p className="mt-1 text-xs text-muted">{loadError}</p>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Active numbers" value={activeNumbers.length} format={(n) => String(Math.round(n))} icon={<PhoneCall />} />
        <Stat label="Calls · last 7 days" value={calls.length} format={(n) => String(Math.round(n))} icon={<PhoneOutgoing />} />
        <Stat label="Connected time" value={totalMinutes} format={(n) => n.toFixed(1)} suffix="min" icon={<PhoneIncoming />} />
      </div>

      <Section title="Numbers" description="The database state used to authorize every AgentPhone operation.">
        <Card className="overflow-hidden">
          {numbers.length === 0 ? (
            <EmptyState
              icon={<PhoneCall />}
              title="No AgentPhone numbers"
              description="A row appears here only after a real paid provisioning request succeeds."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-[13px]">
                <thead>
                  <tr className="border-b border-line text-[11px] uppercase tracking-[0.06em] text-muted">
                    <th className="px-5 py-2.5 text-left font-medium">Number</th>
                    <th className="px-5 py-2.5 text-left font-medium">Market</th>
                    <th className="px-5 py-2.5 text-left font-medium">Provider</th>
                    <th className="px-5 py-2.5 text-right font-medium">Inbound balance</th>
                    <th className="px-5 py-2.5 text-right font-medium">Entitlement expiry</th>
                    <th className="px-5 py-2.5 text-right font-medium">State</th>
                  </tr>
                </thead>
                <tbody>
                  {numbers.map((number) => (
                    <tr key={number.id} className="border-b border-line last:border-0 hover:bg-elevated/50">
                      <td className="px-5 py-3 font-mono font-medium tabular text-text">{number.phone_number}</td>
                      <td className="px-5 py-3 text-text-2">{number.country ?? "—"}</td>
                      <td className="px-5 py-3 text-text-2">{number.provider}</td>
                      <td className="px-5 py-3 text-right font-mono tabular text-text">
                        {(Number(number.inbound_seconds_balance) / 60).toFixed(1)} min
                      </td>
                      <td className="px-5 py-3 text-right text-text-2">
                        {number.entitlement_expires_at ? fmtRelative(number.entitlement_expires_at) : "—"}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <Badge dot variant={activeStates.has(number.lifecycle_status) ? "positive" : "muted"}>
                          {number.lifecycle_status}
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

      <Section title="Calls · last 7 days" description="Real provider call records; recordings are intentionally not collected.">
        <Card className="overflow-hidden">
          {calls.length === 0 ? (
            <EmptyState
              icon={<PhoneOutgoing />}
              title="No calls in this period"
              description="Inbound and outbound calls appear here as AgentPhone events are verified."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-[13px]">
                <thead>
                  <tr className="border-b border-line text-[11px] uppercase tracking-[0.06em] text-muted">
                    <th className="px-5 py-2.5 text-left font-medium">Direction</th>
                    <th className="px-5 py-2.5 text-left font-medium">From</th>
                    <th className="px-5 py-2.5 text-left font-medium">To</th>
                    <th className="px-5 py-2.5 text-left font-medium">Status</th>
                    <th className="px-5 py-2.5 text-right font-medium">Duration</th>
                    <th className="px-5 py-2.5 text-right font-medium">Started</th>
                  </tr>
                </thead>
                <tbody>
                  {calls.map((call) => (
                    <tr key={call.id} className="border-b border-line last:border-0 hover:bg-elevated/50">
                      <td className="px-5 py-3 text-text-2">{call.direction}</td>
                      <td className="px-5 py-3 font-mono tabular text-text">{call.from_number ?? "—"}</td>
                      <td className="px-5 py-3 font-mono tabular text-text-2">{call.to_number ?? "—"}</td>
                      <td className="px-5 py-3"><Badge variant="outline">{call.status}</Badge></td>
                      <td className="px-5 py-3 text-right font-mono tabular text-text">
                        {call.duration_seconds === null ? "—" : `${call.duration_seconds}s`}
                      </td>
                      <td className="px-5 py-3 text-right text-text-2">
                        {fmtRelative(call.started_at ?? call.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </Section>
    </PageContainer>
  )
}
