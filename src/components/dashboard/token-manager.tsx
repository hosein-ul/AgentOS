"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Check, Copy, KeyRound, Plus, ShieldAlert } from "lucide-react"
import { PageContainer, PageHeader } from "@/components/ui/section"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { dashboardAction } from "@/lib/dashboard-client"

type TokenRow = {
  id: string
  token_prefix: string
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

export function TokenManager({
  initialTokens,
  hasTenant,
}: {
  initialTokens: TokenRow[]
  hasTenant: boolean
}) {
  const router = useRouter()
  const [revealed, setRevealed] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function createToken() {
    setPending(true)
    setError(null)
    try {
      const result = await dashboardAction<{ token: string; expiresAt: null }>({ action: "token.create" })
      setRevealed(result.token)
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Token could not be created")
    } finally {
      setPending(false)
    }
  }

  async function revokeToken(tokenId: string) {
    if (!window.confirm("Revoke this agent token? Any agent using it will immediately lose API access.")) return
    setPending(true)
    setError(null)
    try {
      await dashboardAction({ action: "token.revoke", tokenId })
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Token could not be revoked")
    } finally {
      setPending(false)
    }
  }

  async function copyToken() {
    if (!revealed) return
    await navigator.clipboard.writeText(revealed)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <PageContainer>
      <PageHeader
        title="Agent API tokens"
        description="Bearer tokens let autonomous agents use every service owned by this wallet tenant. Tokens do not expire unless you revoke them."
        actions={
          <Button onClick={createToken} disabled={!hasTenant || pending}>
            <Plus /> Create token
          </Button>
        }
      />

      {!hasTenant ? (
        <Card className="border-warn/30 bg-warn-soft p-4 text-sm text-text-2">
          Create your first paid mailbox or phone number before issuing an agent token.
        </Card>
      ) : null}
      {error ? <Card role="alert" className="border-negative/30 bg-negative-soft p-4 text-sm text-negative">{error}</Card> : null}

      {revealed ? (
        <Card className="border-positive/30 bg-positive-soft p-5">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 size-5 shrink-0 text-positive" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Copy this token now</p>
              <p className="mt-1 text-xs text-text-2">AgentOS stores only its hash. The full secret cannot be shown again.</p>
              <div className="mt-4 flex gap-2">
                <code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-line bg-surface px-3 py-2 text-xs">{revealed}</code>
                <Button variant="secondary" onClick={copyToken}>
                  {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              <Button variant="ghost" size="sm" className="mt-3" onClick={() => setRevealed(null)}>I stored it securely</Button>
            </div>
          </div>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        {initialTokens.length === 0 ? (
          <EmptyState
            icon={<KeyRound />}
            title="No agent tokens"
            description="Create a token after your first resource purchase, then give it only to the agent that owns this wallet’s resources."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-[.06em] text-muted">
                  <th className="px-5 py-3">Token prefix</th>
                  <th className="px-5 py-3">Created</th>
                  <th className="px-5 py-3">Last used</th>
                  <th className="px-5 py-3">State</th>
                  <th className="px-5 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {initialTokens.map((token) => (
                  <tr key={token.id} className="border-b border-line last:border-0 hover:bg-elevated/50">
                    <td className="px-5 py-3 font-mono">{token.token_prefix}••••••••</td>
                    <td className="px-5 py-3 text-text-2">{new Date(token.created_at).toLocaleString()}</td>
                    <td className="px-5 py-3 text-text-2">{token.last_used_at ? new Date(token.last_used_at).toLocaleString() : "Never"}</td>
                    <td className="px-5 py-3"><Badge dot variant={token.revoked_at ? "muted" : "positive"}>{token.revoked_at ? "Revoked" : "Active"}</Badge></td>
                    <td className="px-5 py-3 text-right">
                      {!token.revoked_at ? (
                        <Button variant="ghost" size="sm" onClick={() => revokeToken(token.id)} disabled={pending}>Revoke</Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </PageContainer>
  )
}
