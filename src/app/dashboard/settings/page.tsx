import Link from "next/link"
import { ExternalLink, LockKeyhole, Wallet } from "lucide-react"
import { PageContainer, PageHeader, Section } from "@/components/ui/section"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { requireDashboardSession } from "@/lib/dashboard-auth"
import { SERVICE_CATALOG } from "@/lib/v1/service-catalog"

export const dynamic = "force-dynamic"

export default async function SettingsPage() {
  const session = await requireDashboardSession()
  const publicServices = SERVICE_CATALOG.filter((service) => service.registerOnOkx)

  return (
    <PageContainer>
      <PageHeader
        title="Account & integration"
        description="Wallet ownership, tenant binding, and the canonical ASP service catalogue."
        actions={<Button variant="secondary" asChild><Link href="/dashboard/guide">Open agent guide <ExternalLink /></Link></Button>}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-lg bg-elevated"><Wallet className="size-4" /></div>
            <div>
              <p className="text-sm font-semibold">Owner wallet</p>
              <p className="font-mono text-xs text-muted">{session.walletAddress}</p>
            </div>
          </div>
          <dl className="mt-5 grid gap-3 text-sm">
            <div className="flex justify-between gap-4"><dt className="text-text-2">Tenant</dt><dd className="font-mono text-xs">{session.tenantId ?? "Created after first purchase"}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-text-2">Dashboard session</dt><dd><Badge variant="positive" dot>Wallet verified</Badge></dd></div>
            <div className="flex justify-between gap-4"><dt className="text-text-2">Agent authentication</dt><dd className="text-right text-xs">Permanent bearer token</dd></div>
          </dl>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-lg bg-elevated"><LockKeyhole className="size-4" /></div>
            <div>
              <p className="text-sm font-semibold">Isolation model</p>
              <p className="text-xs text-muted">Every database query includes the wallet-bound tenant ID.</p>
            </div>
          </div>
          <p className="mt-5 text-xs leading-5 text-text-2">
            Dashboard signatures are gas-free and create a short-lived HttpOnly session. Autonomous agents use a separate API token. x402 payment proof authorizes only the paid operation and must come from the same owner wallet.
          </p>
        </Card>
      </div>

      <Section title="OKX.AI fixed-price services" description="Canonical available paid endpoints only. Provider price changes do not modify these public ASP prices.">
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-[.06em] text-muted">
                  <th className="px-5 py-3">Service ID</th>
                  <th className="px-5 py-3">Endpoint</th>
                  <th className="px-5 py-3">Price</th>
                  <th className="px-5 py-3 text-right">Guide</th>
                </tr>
              </thead>
              <tbody>
                {publicServices.map((service) => (
                  <tr key={service.id} className="border-b border-line last:border-0 hover:bg-elevated/50">
                    <td className="px-5 py-3 font-mono text-xs">{service.id}</td>
                    <td className="px-5 py-3 font-mono text-xs text-text-2">{service.method} {service.endpoint}</td>
                    <td className="px-5 py-3 font-mono">{service.amount} {service.currency}</td>
                    <td className="px-5 py-3 text-right"><Link href={service.guide} className="text-accent hover:underline">Open</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </Section>
    </PageContainer>
  )
}
