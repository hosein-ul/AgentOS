import { TokenManager } from "@/components/dashboard/token-manager"
import { requireDashboardSession } from "@/lib/dashboard-auth"
import { getTenantDashboardData } from "@/lib/dashboard-data"

export const dynamic = "force-dynamic"

export default async function ApiKeysPage() {
  const session = await requireDashboardSession()
  const { tokens } = await getTenantDashboardData(session.tenantId)
  return <TokenManager initialTokens={tokens} hasTenant={Boolean(session.tenantId)} />
}
