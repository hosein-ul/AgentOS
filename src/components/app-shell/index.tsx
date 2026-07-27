"use client"

import * as React from "react"
import { Sidebar } from "./sidebar"
import { TopBar } from "./topbar"

export function AppShell({
  children,
  walletAddress,
}: {
  children: React.ReactNode
  walletAddress: string
}) {
  const [collapsed, setCollapsed] = React.useState(false)
  const [mobileOpen, setMobileOpen] = React.useState(false)
  return (
    <div className="flex min-h-screen bg-bg text-text">
      <Sidebar
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
        onToggle={() => setCollapsed(v => !v)}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar walletAddress={walletAddress} onOpenMenu={() => setMobileOpen(true)} />
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  )
}
