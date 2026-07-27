import { requireDashboardSession } from "@/lib/dashboard-auth"
import { getTenantDashboardData } from "@/lib/dashboard-data"
import { MailboxManager } from "@/components/dashboard/mailbox-manager"

export const dynamic = "force-dynamic"

export default async function MailboxesPage() {
  const session = await requireDashboardSession()
  const { mailboxes, messages } = await getTenantDashboardData(session.tenantId)
  return <MailboxManager initialMailboxes={mailboxes} initialMessages={messages} />
}
