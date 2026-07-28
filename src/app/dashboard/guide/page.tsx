import Link from "next/link"
import { BookOpen, Bot, CreditCard, ExternalLink, KeyRound, Wallet } from "lucide-react"
import { PageContainer, PageHeader, Section } from "@/components/ui/section"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { SERVICE_CATALOG } from "@/lib/v1/service-catalog"

export default function GuidePage() {
  const available = SERVICE_CATALOG.filter((service) => service.available)

  return (
    <PageContainer>
      <PageHeader
        title="Agent integration guide"
        description="The exact discovery, authentication, payment, ownership, and endpoint flow an autonomous agent needs."
        actions={<Button asChild><Link href="/llms.txt" target="_blank"><Bot /> Open llms.txt</Link></Button>}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <StepCard number="1" icon={<Wallet />} title="Choose the owner wallet">
          The first settled start-service payment creates one tenant bound to its payer wallet. Every mailbox, phone number, call, event, and domain row stores that tenant ID.
        </StepCard>
        <StepCard number="2" icon={<CreditCard />} title="Buy the first resource">
          Call a start-here endpoint without a token. Handle HTTP 402, sign the fixed x402 payment, and retry the byte-equivalent request with the PAYMENT-SIGNATURE header.
        </StepCard>
        <StepCard number="3" icon={<KeyRound />} title="Store the API token">
          The successful first public purchase returns authentication.accessToken once. Dashboard users can also create a permanent token on the Agent tokens page.
        </StepCard>
      </div>

      <Card className="p-5">
        <h2 className="text-sm font-semibold">Authentication rules</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-xs leading-5 text-text-2">
          <li>Dashboard login is a gas-free wallet signature and produces an HttpOnly browser session.</li>
          <li>Agent API calls use <code>Authorization: Bearer at_v1_…</code>. One token works across all services owned by the same wallet tenant.</li>
          <li>Each paid endpoint has its own fixed price and its own HTTP 402 challenge. Creating a token is free.</li>
          <li>No idempotency header is required or accepted. Replaying the same <code>PAYMENT-SIGNATURE</code> returns the stored response instead of repeating the operation.</li>
          <li>Never send an AgentOS API token to AgentPhone, Resend, OKX, or a third-party callback.</li>
        </ul>
      </Card>

      <Section
        title="Canonical discovery files"
        description="Every API response also links back to these machine-readable guides."
      >
        <div className="grid gap-4 md:grid-cols-3">
          <GuideLink href="/docs" title="docs.md" description="Human-readable architecture, flows, payloads, and provider limitations." />
          <GuideLink href="/llms.txt" title="llms.txt" description="Compact instructions designed for agent ingestion." />
          <GuideLink href="/openapi.json" title="OpenAPI" description="Machine-readable request and response contract." />
        </div>
      </Section>

      <Section title="Live service catalogue" description="This table is generated from the same fixed-price catalogue used by API payment enforcement.">
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-[.06em] text-muted">
                  <th className="px-5 py-3">Service</th>
                  <th className="px-5 py-3">Method & endpoint</th>
                  <th className="px-5 py-3">Price</th>
                  <th className="px-5 py-3">Auth</th>
                  <th className="px-5 py-3 text-right">Guide</th>
                </tr>
              </thead>
              <tbody>
                {available.map((service) => (
                  <tr key={service.id} className="border-b border-line last:border-0 hover:bg-elevated/50">
                    <td className="px-5 py-3 font-mono text-xs">{service.id}</td>
                    <td className="px-5 py-3 font-mono text-xs text-text-2">{service.method} {service.endpoint}</td>
                    <td className="px-5 py-3">
                      <Badge variant={service.paid ? "accent" : "muted"}>
                        {service.paid ? `${service.amount} ${service.currency}` : "Free"}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-text-2">{service.authenticated ? "Bearer token" : service.startHere ? "Payment wallet" : "Public"}</td>
                    <td className="px-5 py-3 text-right"><Link href={service.guide} className="text-accent hover:underline">Open</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </Section>
    </PageContainer>
  )
}

function StepCard({
  number,
  icon,
  title,
  children,
}: {
  number: string
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-3">
        <span className="grid size-8 place-items-center rounded-lg bg-accent text-xs font-semibold text-white">{number}</span>
        <span className="text-text-2 [&_svg]:size-4">{icon}</span>
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <p className="mt-4 text-xs leading-5 text-text-2">{children}</p>
    </Card>
  )
}

function GuideLink({ href, title, description }: { href: string; title: string; description: string }) {
  return (
    <Card className="p-5">
      <BookOpen className="size-5 text-accent" />
      <h3 className="mt-3 text-sm font-semibold">{title}</h3>
      <p className="mt-2 text-xs leading-5 text-text-2">{description}</p>
      <Link href={href} target="_blank" className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
        Open <ExternalLink className="size-3" />
      </Link>
    </Card>
  )
}
