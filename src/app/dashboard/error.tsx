"use client"

import { AlertTriangle, RotateCcw } from "lucide-react"
import { PageContainer, PageHeader } from "@/components/ui/section"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <PageContainer>
      <PageHeader title="Dashboard unavailable" description="The owner session is valid, but this page could not load its tenant data." />
      <Card className="flex items-start gap-4 border-negative/30 bg-negative-soft p-5">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-negative" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-negative">The request failed</p>
          <p className="mt-1 break-words text-xs leading-5 text-text-2">{error.message}</p>
          {error.digest ? <p className="mt-2 font-mono text-[11px] text-muted">Reference: {error.digest}</p> : null}
          <Button className="mt-4" variant="secondary" onClick={reset}><RotateCcw /> Try again</Button>
        </div>
      </Card>
    </PageContainer>
  )
}
