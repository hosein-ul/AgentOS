"use client"

import { x402Client, x402HTTPClient } from "@okxweb3/x402-core/client"
import { registerExactEvmScheme } from "@okxweb3/x402-evm/exact/client"
import { getAccount, getWalletClient, switchChain } from "wagmi/actions"
import { xLayer } from "viem/chains"
import { walletConfig } from "@/lib/wallet-config"

function idempotencyKey() { return crypto.randomUUID() }

export async function paidDashboardPost(serviceId: string, input: Record<string, unknown>) {
  const account = getAccount(walletConfig)
  if (!account.isConnected || !account.address) {
    throw new Error("Reconnect the wallet you used to sign in, then try again")
  }
  if (account.chainId !== xLayer.id) {
    await switchChain(walletConfig, { chainId: xLayer.id })
  }
  const walletClient = await getWalletClient(walletConfig, {
    account: account.address,
    chainId: xLayer.id,
  })
  if (!walletClient) throw new Error("The selected wallet is unavailable")
  const address = account.address
  const key = idempotencyKey()
  const makeRequest = (headers: Record<string, string> = {}) => fetch("/api/dashboard/service", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key, ...headers },
    body: JSON.stringify({ serviceId, input }),
  })
  const first = await makeRequest()
  if (first.status !== 402) return first

  const signer = {
    address,
    signTypedData: async (typed: Parameters<typeof walletClient.signTypedData>[0]) =>
      walletClient.signTypedData(typed),
  }
  const client = new x402Client()
  registerExactEvmScheme(client, { signer })
  const http = new x402HTTPClient(client)
  const required = http.getPaymentRequiredResponse((name) => first.headers.get(name))
  const payment = await http.createPaymentPayload(required)
  return makeRequest(http.encodePaymentSignatureHeader(payment))
}
