"use client"

import "@rainbow-me/rainbowkit/styles.css"
import { RainbowKitProvider, lightTheme } from "@rainbow-me/rainbowkit"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState } from "react"
import { WagmiProvider } from "wagmi"
import { walletConfig } from "@/lib/wallet-config"

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())
  return <WagmiProvider config={walletConfig}><QueryClientProvider client={queryClient}><RainbowKitProvider theme={lightTheme({ accentColor: "#2563eb", accentColorForeground: "white" })}>{children}</RainbowKitProvider></QueryClientProvider></WagmiProvider>
}
