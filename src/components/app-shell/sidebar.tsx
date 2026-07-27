"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import { ChevronLeft, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { NAV_SECTIONS } from "./nav-items"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

interface SidebarProps {
  collapsed: boolean
  mobileOpen: boolean
  onCloseMobile: () => void
  onToggle: () => void
}

export function Sidebar({ collapsed, mobileOpen, onCloseMobile, onToggle }: SidebarProps) {
  const pathname = usePathname()

  return (
    <TooltipProvider delayDuration={0}>
      {mobileOpen ? (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={onCloseMobile}
        />
      ) : null}
      <motion.aside
        initial={false}
        animate={{ width: mobileOpen ? 256 : collapsed ? 68 : 256 }}
        transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex shrink-0 flex-col border-r border-line bg-surface transition-transform md:relative md:z-auto md:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {/* Brand */}
        <div className="h-14 flex items-center gap-2.5 px-4 border-b border-line">
          <div className="size-7 rounded-md bg-gradient-to-br from-accent to-[color-mix(in_oklab,var(--accent)_60%,black)] grid place-items-center shrink-0">
            <Sparkles className="size-4 text-white" strokeWidth={2.5} />
          </div>
          <AnimatePresence initial={false}>
            {!collapsed && (
              <motion.div
                key="brand-text"
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -4 }}
                transition={{ duration: 0.15 }}
                className="flex flex-col leading-tight"
              >
                <span className="text-[13px] font-semibold text-text tracking-[-0.01em]">AgentOS</span>
                <span className="text-[10.5px] text-muted uppercase tracking-[0.08em]">
                  OKX.AI ASP
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 flex flex-col gap-4">
          {NAV_SECTIONS.map((section, sIdx) => (
            <div key={sIdx} className="flex flex-col gap-0.5">
              <AnimatePresence initial={false}>
                {!collapsed && section.title && (
                  <motion.div
                    key={`title-${sIdx}`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="px-2.5 pb-1 text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted"
                  >
                    {section.title}
                  </motion.div>
                )}
              </AnimatePresence>
              {section.items.map((item) => {
                const isActive =
                  pathname === item.href ||
                  (item.href !== "/dashboard" && pathname.startsWith(item.href))
                const Icon = item.icon
                const link = (
                  <Link
                    href={item.href}
                    onClick={onCloseMobile}
                    className={cn(
                      "relative flex items-center gap-2.5 rounded-md h-9 px-2.5 text-[13px]",
                      "transition-colors duration-[var(--dur-fast)]",
                      isActive
                        ? "text-text bg-elevated font-medium"
                        : "text-text-2 hover:text-text hover:bg-elevated/60"
                    )}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="active-pill"
                        className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-accent"
                        transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
                      />
                    )}
                    <Icon className="size-4 shrink-0" strokeWidth={1.75} />
                    <AnimatePresence initial={false}>
                      {!collapsed && (
                        <motion.span
                          key={`label-${item.href}`}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="truncate"
                        >
                          {item.label}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </Link>
                )
                return collapsed ? (
                  <Tooltip key={item.href}>
                    <TooltipTrigger asChild>{link}</TooltipTrigger>
                    <TooltipContent side="right">{item.label}</TooltipContent>
                  </Tooltip>
                ) : (
                  <React.Fragment key={item.href}>{link}</React.Fragment>
                )
              })}
            </div>
          ))}
        </nav>

        {/* Collapse toggle */}
        <div className="hidden border-t border-line p-2 md:block">
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggle}
            className="w-full justify-start text-muted hover:text-text"
          >
            <ChevronLeft
              className={cn(
                "size-3.5 transition-transform duration-[var(--dur-base)]",
                collapsed && "rotate-180"
              )}
            />
            {!collapsed && <span>Collapse</span>}
          </Button>
        </div>
      </motion.aside>
    </TooltipProvider>
  )
}
