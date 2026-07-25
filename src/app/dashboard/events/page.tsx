import { EventManager } from "@/components/dashboard/event-manager"
import { requireDashboardSession } from "@/lib/dashboard-auth"
import { getTenantDashboardData } from "@/lib/dashboard-data"

export const dynamic = "force-dynamic"

export default async function EventsPage() {
  const session = await requireDashboardSession()
  const { events } = await getTenantDashboardData(session.tenantId)
  return <EventManager initialEvents={events} />
}
