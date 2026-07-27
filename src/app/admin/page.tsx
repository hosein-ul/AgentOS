import { Activity, CreditCard, Mail, PhoneCall, Users } from "lucide-react"
import { PageContainer, PageHeader } from "@/components/ui/section"
import { Stat } from "@/components/ui/stat"
import { Card } from "@/components/ui/card"
import { getAdminDashboardData } from "@/lib/dashboard-data"

export const dynamic = "force-dynamic"
export default async function AdminPage() {
  const { totals, tenants } = await getAdminDashboardData()
  return <PageContainer><PageHeader title="AgentOS owner administration" description="Private operational view. This route is protected with ADMIN_DASHBOARD_USERNAME and ADMIN_DASHBOARD_PASSWORD." />
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"><Stat label="Wallet tenants" value={totals.tenants} format={String} icon={<Users />} /><Stat label="Mailboxes" value={totals.mailboxes} format={String} icon={<Mail />} /><Stat label="Phone numbers" value={totals.numbers} format={String} icon={<PhoneCall />} /><Stat label="Calls" value={totals.calls} format={String} icon={<Activity />} /><Stat label="Settled payments" value={totals.payments} format={String} icon={<CreditCard />} /><Stat label="Pending events" value={totals.pendingEvents} format={String} icon={<Activity />} /></div>
    <Card className="mt-6 overflow-hidden"><div className="border-b border-line px-5 py-3 text-sm font-medium">Newest wallet tenants</div>{tenants.length === 0 ? <p className="p-5 text-sm text-muted">No v1 tenants yet.</p> : <table className="w-full text-[13px]"><tbody>{tenants.map((tenant) => <tr key={tenant.id} className="border-b border-line last:border-0"><td className="px-5 py-3 font-mono">{tenant.wallet_address}</td><td className="px-5 py-3 text-right text-text-2">{new Date(tenant.created_at).toLocaleString()}</td></tr>)}</tbody></table>}</Card>
  </PageContainer>
}
