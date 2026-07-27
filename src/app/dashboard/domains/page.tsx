import Link from "next/link"
import { Clock, ExternalLink, Globe, Server, ShieldAlert } from "lucide-react"
import { PageContainer, PageHeader, Section } from "@/components/ui/section"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { Stat } from "@/components/ui/stat"
import { requireDashboardSession } from "@/lib/dashboard-auth"
import { getTenantDashboardData } from "@/lib/dashboard-data"
import { fmtRelative } from "@/lib/utils"

export const dynamic = "force-dynamic"

export default async function DomainsPage() {
  const session = await requireDashboardSession()
  const { domains } = await getTenantDashboardData(session.tenantId)
  const trackedExpiries = domains.filter((domain) => Boolean(domain.expires_at)).length

  return (
    <PageContainer>
      <PageHeader
        title="Domains & DNS"
        description="Tenant-owned domain inventory. Registration stays fail-closed until Namecheap static egress and fixed per-TLD ASP prices are production-ready."
        actions={
          <Button variant="secondary" asChild>
            <Link href="/docs#domain-flow"><ExternalLink /> Provider setup guide</Link>
          </Button>
        }
      />

      <Card className="flex items-start gap-3 border-warn/30 bg-warn-soft p-4">
        <ShieldAlert className="mt-0.5 size-5 shrink-0 text-warn" />
        <div>
          <p className="text-sm font-semibold text-text">Registration is intentionally unavailable</p>
          <p className="mt-1 text-xs leading-5 text-text-2">
            AgentOS will not request payment or simulate success until the registrar can be reached from an allowlisted static IP and each TLD has a fixed public price.
          </p>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Registered domains" value={domains.length} icon={<Globe />} />
        <Stat label="Active domains" value={domains.filter((domain) => domain.status === "active").length} icon={<Server />} />
        <Stat label="Tracked expiries" value={trackedExpiries} icon={<Clock />} />
      </div>

      <Section title="Your domains" description="Only rows owned by the signed-in wallet tenant are shown.">
        <Card className="overflow-hidden">
          {domains.length === 0 ? (
            <EmptyState
              icon={<Globe />}
              title="No domains"
              description="No real registrar-backed domain has been provisioned for this wallet."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-[.06em] text-muted">
                    <th className="px-5 py-3">Domain</th>
                    <th className="px-5 py-3">Created</th>
                    <th className="px-5 py-3">Expires</th>
                    <th className="px-5 py-3 text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {domains.map((domain) => (
                    <tr key={domain.id} className="border-b border-line last:border-0 hover:bg-elevated/50">
                      <td className="px-5 py-3 font-mono font-medium">{domain.domain_name}</td>
                      <td className="px-5 py-3 text-text-2">{fmtRelative(domain.created_at)}</td>
                      <td className="px-5 py-3 text-text-2">{domain.expires_at ? fmtRelative(domain.expires_at) : "—"}</td>
                      <td className="px-5 py-3 text-right"><Badge dot variant={domain.status === "active" ? "positive" : "muted"}>{domain.status}</Badge></td>
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
