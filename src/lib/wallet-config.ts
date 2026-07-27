"use client"

import { getDefaultConfig } from "@rainbow-me/rainbowkit"
import { injectedWallet } from "@rainbow-me/rainbowkit/wallets"
import { xLayer } from "viem/chains"
import { http } from "viem"

export const walletConfig = getDefaultConfig({
  appName: "AgentOS",
  appDescription: "Real communication infrastructure for AI agents",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  // This dashboard deliberately supports browser-injected EVM wallets only.
  // No WalletConnect connector is registered, so no WalletConnect project ID is needed.
  projectId: "injected-wallets-only",
  wallets: [{ groupName: "Browser wallets", wallets: [injectedWallet] }],
  chains: [xLayer],
  transports: { [xLayer.id]: http(xLayer.rpcUrls.default.http[0]) },
  ssr: true,
})
