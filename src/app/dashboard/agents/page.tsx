import { redirect } from "next/navigation"

// Historic Agent records are now wallet-owned v1 mailboxes.
export default function AgentsPage() { redirect("/dashboard/mailboxes") }
