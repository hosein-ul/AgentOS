"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  BookOpen,
  ChevronDown,
  Clock3,
  PhoneCall,
  PhoneIncoming,
  PhoneOutgoing,
  Plus,
  X,
} from "lucide-react"
import { PageContainer, PageHeader, Section } from "@/components/ui/section"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { Stat } from "@/components/ui/stat"
import { paidDashboardPost } from "@/lib/browser-x402"
import { dashboardAction, responseData } from "@/lib/dashboard-client"
import { fmtRelative } from "@/lib/utils"

type PhoneNumber = {
  id: string
  phone_number: string
  country: string | null
  provider: string
  lifecycle_status: string
  entitlement_expires_at: string | null
  inbound_seconds_balance: number
  created_at: string
}

type Call = {
  id: string
  phone_number_id: string | null
  direction: string
  status: string
  from_number: string | null
  to_number: string | null
  duration_seconds: number | null
  authorized_seconds?: number | null
  started_at: string | null
  created_at: string
}

type PhoneManagerProps = {
  initialNumbers: PhoneNumber[]
  initialCalls: Call[]
  purchasePrice: string
  renewalPrice: string
}

type Panel = "purchase" | "call" | null

const ACTIVE_STATES = new Set(["active", "renewal_due", "renewal_authorized"])

export function PhoneManager({ initialNumbers, initialCalls, purchasePrice, renewalPrice }: PhoneManagerProps) {
  const router = useRouter()
  const activeNumbers = initialNumbers.filter((number) => ACTIVE_STATES.has(number.lifecycle_status))
  const [panel, setPanel] = useState<Panel>(null)
  const [country, setCountry] = useState<"US" | "CA">("US")
  const [agentName, setAgentName] = useState("")
  const [webhookUrl, setWebhookUrl] = useState("")
  const [areaCode, setAreaCode] = useState("")
  const [numberId, setNumberId] = useState(activeNumbers[0]?.id ?? "")
  const [toNumber, setToNumber] = useState("")
  const [callPlan, setCallPlan] = useState<"1m" | "5m">("1m")
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [transcript, setTranscript] = useState<{ callId: string; value: unknown } | null>(null)

  const totalMinutes = initialCalls.reduce(
    (sum, call) => sum + Number(call.duration_seconds ?? 0),
    0,
  ) / 60

  async function runPaid(serviceId: string, input: Record<string, unknown>, key = serviceId) {
    setPending(key)
    setError(null)
    try {
      const response = await paidDashboardPost(serviceId, input)
      await responseData(response)
      setPanel(null)
      router.refresh()
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Phone operation failed")
      return false
    } finally {
      setPending(null)
    }
  }

  async function purchase() {
    const serviceId = country === "US" ? "phone.number.us.30d" : "phone.number.ca.30d"
    await runPaid(serviceId, {
      agentName: agentName.trim(),
      agentWebhookUrl: webhookUrl.trim(),
      areaCode: areaCode.trim() || undefined,
    })
  }

  async function startCall() {
    const serviceId = callPlan === "1m" ? "phone.call.outbound.1m" : "phone.call.outbound.5m"
    if (await runPaid(serviceId, { phoneNumberId: numberId, toNumber: toNumber.trim() })) {
      setToNumber("")
    }
  }

  async function release(number: PhoneNumber) {
    const confirmed = window.confirm(
      `Release ${number.phone_number} permanently? This cannot be undone and stops future AgentOS usage.`,
    )
    if (!confirmed) return
    setPending(`release:${number.id}`)
    setError(null)
    try {
      await dashboardAction({
        action: "phone.release",
        phoneNumberId: number.id,
        confirmRelease: true,
      })
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Number could not be released")
    } finally {
      setPending(null)
    }
  }

  async function loadTranscript(callId: string) {
    setPending(`transcript:${callId}`)
    setError(null)
    try {
      const response = await fetch(`/api/dashboard/calls/${encodeURIComponent(callId)}/transcript`)
      setTranscript({ callId, value: await responseData(response) })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Transcript could not be loaded")
    } finally {
      setPending(null)
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title="AgentPhone"
        description="Provision real US or Canadian numbers, run live agent-controlled calls, manage entitlement, and read transcripts. Recording is disabled."
        actions={
          <>
            <Button variant="secondary" asChild>
              <Link href="/docs#phone-flow"><BookOpen /> Agent guide</Link>
            </Button>
            <Button onClick={() => setPanel("purchase")}><Plus /> Buy number · {purchasePrice} USDT</Button>
          </>
        }
      />

      {error ? (
        <Card role="alert" className="border-negative/30 bg-negative-soft p-4 text-sm text-negative">
          {error}
        </Card>
      ) : null}

      {panel === "purchase" ? (
        <Card className="p-5">
          <PanelHeading title="Provision an AgentPhone number" onClose={() => setPanel(null)} />
          <p className="mt-1 text-xs leading-5 text-muted">
            The callback URL is your agent’s public HTTPS endpoint. AgentOS forwards live conversation turns there so the agent—not a preset assistant—decides what to say.
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="Country">
              <select
                value={country}
                onChange={(event) => setCountry(event.target.value as "US" | "CA")}
                className="h-9 w-full rounded-md border border-line bg-surface px-3 text-sm"
              >
                <option value="US">United States · {purchasePrice} USDT / 30 days</option>
                <option value="CA">Canada · {purchasePrice} USDT / 30 days</option>
              </select>
            </Field>
            <Field label="Agent name">
              <Input value={agentName} onChange={(event) => setAgentName(event.target.value)} placeholder="Sales Agent" />
            </Field>
            <Field label="Live-agent callback URL">
              <Input value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder="https://agent.example.com/voice" />
            </Field>
            <Field label="Area code (optional)">
              <Input value={areaCode} onChange={(event) => setAreaCode(event.target.value.replace(/\D/g, "").slice(0, 3))} placeholder="415" inputMode="numeric" />
            </Field>
          </div>
          <div className="mt-4 flex gap-2">
            <Button
              onClick={purchase}
              disabled={Boolean(pending) || !agentName.trim() || !webhookUrl.startsWith("https://") || Boolean(areaCode && areaCode.length !== 3)}
            >
              {pending ? "Confirm in wallet…" : `Pay ${purchasePrice} USDT and provision`}
            </Button>
            <Button variant="secondary" onClick={() => setPanel(null)} disabled={Boolean(pending)}>Cancel</Button>
          </div>
        </Card>
      ) : null}

      {panel === "call" ? (
        <Card className="p-5">
          <PanelHeading title="Start an outbound live call" onClose={() => setPanel(null)} />
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <Field label="From">
              <select
                value={numberId}
                onChange={(event) => setNumberId(event.target.value)}
                className="h-9 w-full rounded-md border border-line bg-surface px-3 text-sm"
              >
                {activeNumbers.map((number) => <option key={number.id} value={number.id}>{number.phone_number}</option>)}
              </select>
            </Field>
            <Field label="Destination (E.164)">
              <Input value={toNumber} onChange={(event) => setToNumber(event.target.value)} placeholder="+14155550123" />
            </Field>
            <Field label="Call allowance">
              <select
                value={callPlan}
                onChange={(event) => setCallPlan(event.target.value as "1m" | "5m")}
                className="h-9 w-full rounded-md border border-line bg-surface px-3 text-sm"
              >
                <option value="1m">Up to 1 minute · 0.30 USDT</option>
                <option value="5m">Up to 5 minutes · 1.50 USDT</option>
              </select>
            </Field>
          </div>
          <div className="mt-4 flex gap-2">
            <Button
              onClick={startCall}
              disabled={Boolean(pending) || !numberId || !/^\+[1-9]\d{6,14}$/.test(toNumber)}
            >
              {pending ? "Confirm in wallet…" : `Pay ${callPlan === "1m" ? "0.30" : "1.50"} USDT and call`}
            </Button>
            <Button variant="secondary" onClick={() => setPanel(null)} disabled={Boolean(pending)}>Cancel</Button>
          </div>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Active numbers" value={activeNumbers.length} icon={<PhoneCall />} />
        <Stat label="Calls · last 30 days" value={initialCalls.length} icon={<PhoneOutgoing />} />
        <Stat label="Connected time" value={totalMinutes} format={(value) => value.toFixed(1)} suffix="min" icon={<PhoneIncoming />} />
      </div>

      <Section
        title="Numbers"
        description="Each number has a fixed 30-day AgentOS entitlement."
        actions={
          <Button variant="secondary" onClick={() => setPanel("call")} disabled={!activeNumbers.length}>
            <PhoneOutgoing /> Start call
          </Button>
        }
      >
        <Card className="overflow-hidden">
          {initialNumbers.length === 0 ? (
            <EmptyState
              icon={<PhoneCall />}
              title="No phone numbers"
              description="Provisioning runs only after a real x402 payment and a successful AgentPhone provider response."
              action={<Button onClick={() => setPanel("purchase")}><Plus /> Buy number</Button>}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1050px] text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-[.06em] text-muted">
                    <th className="px-5 py-3">Number</th>
                    <th className="px-5 py-3">Market</th>
                    <th className="px-5 py-3">Inbound balance</th>
                    <th className="px-5 py-3">Expires</th>
                    <th className="px-5 py-3">State</th>
                    <th className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {initialNumbers.map((number) => {
                    const active = ACTIVE_STATES.has(number.lifecycle_status)
                    return (
                      <tr key={number.id} className="border-b border-line last:border-0 hover:bg-elevated/50">
                        <td className="px-5 py-3 font-mono font-medium">{number.phone_number}</td>
                        <td className="px-5 py-3 text-text-2">{number.country ?? "—"}</td>
                        <td className="px-5 py-3 font-mono">{(Number(number.inbound_seconds_balance) / 60).toFixed(1)} min</td>
                        <td className="px-5 py-3 text-text-2">{number.entitlement_expires_at ? fmtRelative(number.entitlement_expires_at) : "—"}</td>
                        <td className="px-5 py-3"><Badge dot variant={active ? "positive" : "muted"}>{number.lifecycle_status}</Badge></td>
                        <td className="px-5 py-3">
                          <div className="flex justify-end gap-2">
                            {active ? (
                              <>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => runPaid("phone.number.renew.30d", { phoneNumberId: number.id }, `renew:${number.id}`)}
                                  disabled={Boolean(pending)}
                                >
                                  Renew · {renewalPrice}
                                </Button>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => runPaid("phone.call.inbound.add.10m", { phoneNumberId: number.id }, `inbound:${number.id}`)}
                                  disabled={Boolean(pending)}
                                >
                                  +10 inbound min · 3.00
                                </Button>
                              </>
                            ) : null}
                            {number.lifecycle_status !== "released" ? (
                              <Button variant="ghost" size="sm" onClick={() => release(number)} disabled={Boolean(pending)}>
                                Release
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </Section>

      <Section title="Calls · last 30 days" description="Verified provider state and transcripts only; recordings are never collected.">
        <Card className="overflow-hidden">
          {initialCalls.length === 0 ? (
            <EmptyState icon={<PhoneOutgoing />} title="No calls in this period" description="Inbound and outbound calls appear after verified AgentPhone events." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-[.06em] text-muted">
                    <th className="px-5 py-3">Direction</th>
                    <th className="px-5 py-3">From</th>
                    <th className="px-5 py-3">To</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Duration</th>
                    <th className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {initialCalls.map((call) => {
                    const active = ["initiated", "ringing", "in-progress", "active"].includes(call.status)
                    return (
                      <tr key={call.id} className="border-b border-line last:border-0 hover:bg-elevated/50">
                        <td className="px-5 py-3 text-text-2">{call.direction}</td>
                        <td className="px-5 py-3 font-mono">{call.from_number ?? "—"}</td>
                        <td className="px-5 py-3 font-mono text-text-2">{call.to_number ?? "—"}</td>
                        <td className="px-5 py-3"><Badge variant="outline">{call.status}</Badge></td>
                        <td className="px-5 py-3 font-mono">{call.duration_seconds === null ? "—" : `${call.duration_seconds}s`}</td>
                        <td className="px-5 py-3">
                          <div className="flex justify-end gap-2">
                            {active ? (
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => runPaid("phone.call.extend.1m", { callId: call.id }, `extend:${call.id}`)}
                                disabled={Boolean(pending)}
                              >
                                <Clock3 /> +1 min · 0.30
                              </Button>
                            ) : null}
                            <Button variant="ghost" size="sm" onClick={() => loadTranscript(call.id)} disabled={Boolean(pending)}>
                              Transcript <ChevronDown />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {transcript ? (
            <div className="border-t border-line bg-elevated/40 p-5">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Transcript · {transcript.callId}</p>
                <Button variant="ghost" size="icon-sm" onClick={() => setTranscript(null)} aria-label="Close transcript"><X /></Button>
              </div>
              <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-surface p-4 text-xs leading-6">
                {JSON.stringify(transcript.value, null, 2)}
              </pre>
            </div>
          ) : null}
        </Card>
      </Section>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label>
      <span className="mb-1.5 block text-xs font-medium text-text-2">{label}</span>
      {children}
    </label>
  )
}
