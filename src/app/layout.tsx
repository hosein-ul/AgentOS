import type { Metadata } from "next"
import { GeistSans } from "geist/font/sans"
import { GeistMono } from "geist/font/mono"
import { ThemeProvider } from "@/components/theme-provider"
import { WalletProvider } from "@/components/wallet-provider"
import { Toaster } from "@/components/ui/sonner"
import "./globals.css"

const siteUrl = process.env.APP_URL?.replace(/\/$/, "")

const title = "AgentOS — Onchain execution and communication infrastructure for AI agents"
const description =
  "One OKX.AI Agent Service Provider for both models: Swap & Bridge Execution as an A2A service across 80 chains, plus Agent Email, Agent Phone and durable realtime events as fixed-price A2MCP operations settled through x402."

export const metadata: Metadata = {
  // Only set when APP_URL is configured, so no deployment domain is baked in.
  ...(siteUrl ? { metadataBase: new URL(siteUrl) } : {}),
  title: {
    default: title,
    template: "%s — AgentOS",
  },
  description,
  applicationName: "AgentOS",
  keywords: [
    "AgentOS",
    "OKX.AI",
    "Agent Service Provider",
    "A2A",
    "A2MCP",
    "x402",
    "cross-chain swap",
    "bridge execution",
    "agent email",
    "agent phone",
  ],
  openGraph: {
    type: "website",
    siteName: "AgentOS",
    title,
    description,
    ...(siteUrl ? { url: siteUrl } : {}),
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
  robots: { index: true, follow: true },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <ThemeProvider>
          <WalletProvider>
            {children}
            <Toaster />
          </WalletProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
