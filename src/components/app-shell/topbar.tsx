"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Bell, LogOut, Menu, Search, ShieldCheck } from "lucide-react"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"

const SEARCH_ROUTES = [
  { terms: ["mail", "email", "inbox", "message"], route: "/dashboard/mailboxes" },
  { terms: ["phone", "call", "number", "transcript"], route: "/dashboard/numbers" },
  { terms: ["domain", "dns"], route: "/dashboard/domains" },
  { terms: ["event", "notification"], route: "/dashboard/events" },
  { terms: ["token", "key", "auth"], route: "/dashboard/api-keys" },
  { terms: ["docs", "guide", "api"], route: "/dashboard/guide" },
] as const

export function TopBar({
  walletAddress,
  onOpenMenu,
}: {
  walletAddress: string
  onOpenMenu: () => void
}) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [loggingOut, setLoggingOut] = useState(false)

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalized = query.trim().toLowerCase()
    const match = SEARCH_ROUTES.find((item) => item.terms.some((term) => normalized.includes(term)))
    router.push(match?.route ?? "/dashboard")
    setQuery("")
  }

  async function logout() {
    setLoggingOut(true)
    await fetch("/api/dashboard/auth/logout", { method: "POST" }).catch(() => undefined)
    router.replace("/login")
    router.refresh()
  }

  return (
    <header className="sticky top-0 z-30 h-14 border-b border-line bg-surface/90 backdrop-blur-md">
      <div className="flex h-full items-center gap-3 px-4 md:px-5">
        <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={onOpenMenu} aria-label="Open navigation">
          <Menu />
        </Button>
        <form onSubmit={search} className="flex h-8 w-full max-w-md items-center gap-2 rounded-md border border-line bg-elevated/40 px-2.5">
          <Search className="size-3.5 text-muted" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find email, phone, domains, events…"
            aria-label="Search dashboard sections"
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted"
          />
        </form>
        <div className="flex-1" />
        <div className="hidden items-center gap-2 rounded-md border border-line bg-elevated/40 px-2.5 py-1.5 md:flex">
          <ShieldCheck className="size-3.5 text-positive" />
          <span className="text-xs text-text-2">Verified</span>
          <code className="text-xs font-medium">{walletAddress.slice(0, 6)}…{walletAddress.slice(-4)}</code>
        </div>
        <Button variant="ghost" size="icon-sm" asChild aria-label="Open notifications">
          <Link href="/dashboard/events"><Bell /></Link>
        </Button>
        <ThemeToggle />
        <Button variant="ghost" size="icon-sm" onClick={logout} disabled={loggingOut} aria-label="Sign out">
          <LogOut />
        </Button>
      </div>
    </header>
  )
}
