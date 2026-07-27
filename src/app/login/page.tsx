"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ShieldCheck, Wallet } from "lucide-react"
import { useConnectModal } from "@rainbow-me/rainbowkit"
import { useAccount, useSignMessage } from "wagmi"

type WalletRequestError = Error & { code?: number }

export default function DashboardLoginPage() {
  const router = useRouter(); const { address, isConnected } = useAccount(); const { openConnectModal } = useConnectModal(); const { signMessageAsync } = useSignMessage(); const [error, setError] = useState<string | null>(null); const [pending, setPending] = useState(false)
  async function connect() {
    setError(null)
    if (!isConnected || !address) {
      openConnectModal?.()
      return
    }
    setPending(true)
    try {
      const walletAddress = address
      const nonceResponse = await fetch("/api/dashboard/auth/challenge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ walletAddress }) }); const nonceData = await nonceResponse.json()
      if (!nonceResponse.ok) throw new Error(nonceData.error ?? "Could not start wallet sign-in")
      const signature = await signMessageAsync({ message: nonceData.message })
      const verifyResponse = await fetch("/api/dashboard/auth/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ walletAddress, nonce: nonceData.nonce, signature }) }); const verifyData = await verifyResponse.json()
      if (!verifyResponse.ok) throw new Error(verifyData.error ?? "Could not verify your signature")
      router.replace("/dashboard"); router.refresh()
    } catch (cause) {
      const walletError = cause as WalletRequestError
      setError(walletError?.code === 4001 ? "Wallet connection or signature was declined. Approve the request in your wallet and try again." : cause instanceof Error ? cause.message : "Wallet sign-in failed")
    } finally { setPending(false) }
  }
  return <main className="grid min-h-screen place-items-center bg-bg p-5 text-text"><section className="w-full max-w-md rounded-xl border border-line bg-surface p-7 shadow-2xl shadow-black/10"><div className="mb-7 flex items-center gap-3"><div className="grid size-11 place-items-center rounded-lg bg-accent text-white"><ShieldCheck /></div><div><p className="font-semibold">AgentOS Dashboard</p><p className="text-xs text-muted">Private resources, wallet-verified</p></div></div><h1 className="text-2xl font-semibold tracking-tight">Sign in with your owner wallet</h1><p className="mt-2 text-sm leading-6 text-text-2">Choose your wallet with RainbowKit, then sign one message to prove ownership. This creates no transaction, charges no gas, and never exposes your AgentOS API token.</p>{error ? <p role="alert" className="mt-5 rounded-md border border-negative/30 bg-negative/10 p-3 text-sm text-negative">{error}</p> : null}<button onClick={connect} disabled={pending} className="mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"><Wallet className="size-4" />{pending ? "Waiting for wallet..." : isConnected ? "Sign in with selected wallet" : "Choose wallet"}</button>{isConnected && address ? <p className="mt-3 text-center font-mono text-xs text-muted">Connected: {address.slice(0, 6)}…{address.slice(-4)}</p> : null}<p className="mt-5 text-center text-xs leading-5 text-muted">Use the wallet that owns your AgentOS resources. New owners can sign in first, then make their first paid purchase from the dashboard.</p></section></main>
}
