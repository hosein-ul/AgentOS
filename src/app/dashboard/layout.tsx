import { AppShell } from "@/components/app-shell"
import { requireDashboardSession } from "@/lib/dashboard-auth"

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireDashboardSession()
  return <AppShell walletAddress={session.walletAddress}>{children}</AppShell>
}
