import { PhoneManager } from "@/components/dashboard/phone-manager"
import { requireDashboardSession } from "@/lib/dashboard-auth"
import { getTenantDashboardData } from "@/lib/dashboard-data"
import { PHONE_SERVICES } from "@/lib/v1/service-catalog"

export const dynamic = "force-dynamic"

export default async function NumbersPage() {
  const session = await requireDashboardSession()
  const { numbers, calls } = await getTenantDashboardData(session.tenantId)
  return (
    <PhoneManager
      initialNumbers={numbers}
      initialCalls={calls}
      purchasePrice={PHONE_SERVICES.purchaseUsNumber30Days.amount}
      renewalPrice={PHONE_SERVICES.renewNumber30Days.amount}
    />
  )
}
