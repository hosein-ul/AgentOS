import Link from "next/link"
import { EMAIL_SERVICES, PHONE_SERVICES } from "@/lib/v1/service-catalog"

// Swap & Bridge Execution is an OKX A2A service with negotiated pricing and its
// own runtime. It is deliberately absent from the REST A2MCP service catalog and
// from /openapi.json, so its copy lives here rather than being derived from them.
const execution = {
  label: "A2A / EXECUTION",
  title: "Onchain execution",
  name: "Swap & Bridge Execution",
  // Rendered verbatim: a starting fee is not a fixed price, so no USDT suffix
  // is appended to it anywhere on this page.
  price: "FROM 0.09",
  priceNote: "Starting marketplace fee in USDT. The final service fee is calculated and agreed before the job is accepted.",
  detail: "Same-chain swaps, bridges and cross-chain swaps. Routes are compared across providers, transactions are validated and prepared, execution is monitored, and stuck jobs support recovery.",
  providers: ["OKX", "LI.FI", "Across"],
  catalogue: [
    { value: "80", unit: "chains" },
    { value: "19,179", unit: "assets" },
    { value: "51,703", unit: "provider capabilities" },
  ],
}

// A2MCP prices come from the canonical catalog so this page can never drift from
// what the API actually charges. Each entry renders its own complete price
// string; nothing is suffixed blindly.
const infrastructure = [
  {
    label: "MAIL",
    title: "A real inbox",
    provider: "Resend",
    price: `${EMAIL_SERVICES.createMailbox.amount} USDT`,
    detail: "Provision, send, receive, retrieve.",
  },
  {
    label: "VOICE",
    title: "A live number",
    provider: "AgentPhone",
    price: `${PHONE_SERVICES.purchaseUsNumber30Days.amount} USDT / 30d`,
    detail: "Inbound and outbound conversations controlled by the agent over WebSocket.",
  },
  {
    label: "EVENTS",
    title: "A durable signal",
    provider: "Supabase + WSS",
    price: "FREE",
    detail: "Immediate delivery, offline replay, explicit acknowledgement.",
  },
]

const models = [
  {
    kind: "A2MCP",
    heading: "Fixed-price operations",
    points: [
      "One published catalog price per operation.",
      "Settled through x402 on the same request.",
      "Synchronous: the call returns the result.",
      "Discoverable at /api/v1/services and /openapi.json.",
    ],
  },
  {
    kind: "A2A",
    heading: "Negotiated jobs",
    points: [
      "Fee calculated and agreed before acceptance.",
      "Long-running with explicit execution state.",
      "Monitored, with recovery for stuck jobs.",
      "Buyer signs and broadcasts; funds stay with the buyer.",
    ],
  },
]

const flow = [
  "Discover a fixed-price service",
  "Receive the x402 challenge",
  "Pay and replay the same request",
  "Keep one wallet-bound access token",
]

export default function LandingPage() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#11120f] text-[#f2f0e8]">
      <div className="pointer-events-none fixed inset-0 opacity-[0.08] [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] [background-size:42px_42px]" />
      <nav className="relative z-10 border-b border-[#34362e]">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <Link href="/" className="font-serif text-2xl tracking-[-0.04em]">
            AgentOS<span className="text-[#e7ff4f]">/</span>
          </Link>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em]">
            <Link href="/docs" className="px-4 py-2 text-[#b9b9ae] transition hover:text-white">Docs</Link>
            <Link href="/api/v1/services" className="px-4 py-2 text-[#b9b9ae] transition hover:text-white">Services</Link>
            <Link href="/dashboard" className="border border-[#e7ff4f] px-4 py-2 text-[#e7ff4f] transition hover:bg-[#e7ff4f] hover:text-[#11120f]">
              Owner dashboard
            </Link>
          </div>
        </div>
      </nav>

      <section className="relative mx-auto grid max-w-7xl gap-12 px-6 pb-20 pt-20 lg:grid-cols-[1.25fr_0.75fr] lg:pt-28">
        <div>
          <div className="mb-7 inline-flex items-center gap-3 border border-[#4a4c40] bg-[#171813] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[#c4c5b8]">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[#e7ff4f]" />
            A2MCP services and A2A execution for autonomous agents
          </div>
          <h1 className="max-w-4xl font-serif text-[clamp(4.3rem,9vw,8.6rem)] leading-[0.82] tracking-[-0.075em]">
            Agents need
            <span className="block text-[#e7ff4f]">a way out.</span>
          </h1>
          <p className="mt-9 max-w-2xl text-lg leading-8 text-[#b9b9ae]">
            AgentOS gives AI agents email, live phone conversations and onchain execution. Fixed-price A2MCP operations settle through x402 on a wallet-isolated REST API; A2A execution jobs are quoted, agreed, monitored and recoverable.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link href="/llms.txt" className="bg-[#e7ff4f] px-6 py-3 text-sm font-bold uppercase tracking-[0.12em] text-[#11120f] transition hover:bg-white">
              Agent start file
            </Link>
            <Link href="/openapi.json" className="border border-[#56584c] px-6 py-3 text-sm font-bold uppercase tracking-[0.12em] transition hover:border-white">
              OpenAPI 3.1
            </Link>
          </div>
        </div>

        <aside className="self-end border-l border-[#34362e] pl-6 lg:mb-2">
          <p className="mb-6 font-mono text-[11px] uppercase tracking-[0.22em] text-[#77796c]">First successful A2MCP operation</p>
          <ol className="space-y-0">
            {flow.map((step, index) => (
              <li key={step} className="grid grid-cols-[2.5rem_1fr] border-t border-[#34362e] py-4 text-sm">
                <span className="font-mono text-[#e7ff4f]">0{index + 1}</span>
                <span className="text-[#d2d1c7]">{step}</span>
              </li>
            ))}
          </ol>
          <p className="border-t border-[#34362e] pt-5 text-xs leading-5 text-[#77796c]">
            No paid token endpoint. No caller-supplied tenant ID. No automatic price changes.
          </p>
        </aside>
      </section>

      <section className="relative border-y border-[#34362e] bg-[#151610]">
        <div className="mx-auto max-w-7xl">
          <article className="border-b border-[#34362e] p-7 lg:p-10">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <span className="font-mono text-[10px] tracking-[0.24em] text-[#e7ff4f]">{execution.label}</span>
              <span className="font-mono text-xs text-[#77796c]">{execution.price}</span>
            </div>
            <div className="mt-10 grid gap-10 lg:grid-cols-[1.15fr_0.85fr]">
              <div>
                <h2 className="font-serif text-[clamp(2.9rem,5.4vw,4.6rem)] leading-[0.9] tracking-[-0.05em]">
                  {execution.title}
                </h2>
                <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.2em] text-[#e7ff4f]">
                  {execution.name}
                </p>
                <p className="mt-5 max-w-xl text-base leading-7 text-[#9b9c90]">{execution.detail}</p>
                <p className="mt-5 max-w-xl text-sm leading-6 text-[#77796c]">
                  Non-custodial: AgentOS never holds funds and never signs for the buyer. The buyer signs and broadcasts every transaction. Gas, DEX, bridge and provider fees are separate from the service fee.
                </p>
                <p className="mt-5 max-w-xl text-xs leading-5 text-[#77796c]">{execution.priceNote}</p>
              </div>
              <div className="border-l-0 border-t border-[#34362e] pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#77796c]">Route aggregation</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {execution.providers.map((provider) => (
                    <span key={provider} className="border border-[#4a4c40] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-[#d2d1c7]">
                      {provider}
                    </span>
                  ))}
                </div>
                <p className="mt-8 font-mono text-[10px] uppercase tracking-[0.22em] text-[#77796c]">Current catalogue</p>
                <dl className="mt-4 space-y-0">
                  {execution.catalogue.map((item) => (
                    <div key={item.unit} className="flex items-baseline justify-between border-t border-[#34362e] py-3">
                      <dt className="text-xs uppercase tracking-[0.14em] text-[#77796c]">{item.unit}</dt>
                      <dd className="font-mono text-xl text-[#e7ff4f]">{item.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          </article>

          <div className="grid md:grid-cols-3">
            {infrastructure.map((service, index) => (
              <article key={service.label} className={`group min-h-72 p-7 transition hover:bg-[#1b1d15] ${index > 0 ? "border-t border-[#34362e] md:border-l md:border-t-0" : ""}`}>
                <div className="flex items-start justify-between">
                  <span className="font-mono text-[10px] tracking-[0.24em] text-[#e7ff4f]">{service.label}</span>
                  <span className="font-mono text-xs text-[#77796c]">{service.price}</span>
                </div>
                <h2 className="mt-16 font-serif text-4xl tracking-[-0.04em]">{service.title}</h2>
                <p className="mt-4 max-w-xs text-sm leading-6 text-[#9b9c90]">{service.detail}</p>
                <p className="mt-7 font-mono text-[10px] uppercase tracking-[0.18em] text-[#5f6156]">Provider / {service.provider}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="relative mx-auto max-w-7xl px-6 py-20">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#e7ff4f]">Two service models, one provider identity</p>
        <h2 className="mt-5 max-w-3xl font-serif text-5xl leading-[0.95] tracking-[-0.05em]">
          A fixed price and an agreed price are not the same promise.
        </h2>
        <div className="mt-12 grid gap-0 md:grid-cols-2">
          {models.map((model, index) => (
            <div key={model.kind} className={`border-t border-[#34362e] py-8 md:py-0 ${index > 0 ? "md:border-l md:pl-10" : "md:pr-10"} md:border-t-0`}>
              <span className="font-mono text-[10px] tracking-[0.24em] text-[#e7ff4f]">{model.kind}</span>
              <h3 className="mt-4 font-serif text-3xl tracking-[-0.04em]">{model.heading}</h3>
              <ul className="mt-6 space-y-0">
                {model.points.map((point) => (
                  <li key={point} className="border-t border-[#34362e] py-3 text-sm leading-6 text-[#9b9c90]">
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="relative mx-auto grid max-w-7xl gap-10 px-6 pb-20 lg:grid-cols-[0.7fr_1.3fr]">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#e7ff4f]">Machine-first discovery</p>
          <h2 className="mt-5 font-serif text-5xl leading-[0.95] tracking-[-0.05em]">An agent should never have to guess.</h2>
        </div>
        <div className="border border-[#34362e] bg-[#0d0e0b] p-6 font-mono text-sm leading-7 text-[#bdbeaf] shadow-[10px_10px_0_#e7ff4f]">
          <p className="text-[#77796c]">$ curl /api/v1/services/phone.number.us.30d</p>
          <p className="mt-3">serviceId: <span className="text-white">phone.number.us.30d</span></p>
          <p>endpoint: <span className="text-white">POST /api/v1/phone/purchase-us-number-30-days</span></p>
          <p>fixedPrice: <span className="text-[#e7ff4f]">{PHONE_SERVICES.purchaseUsNumber30Days.amount} USDT</span></p>
          <p>startHere: <span className="text-white">true</span></p>
          <p>providerSuccess: <span className="text-white">real_only</span></p>
          <p className="mt-4 text-[#77796c]">A2A execution is negotiated per job and is not listed in this REST catalog.</p>
        </div>
      </section>

      <footer className="relative border-t border-[#34362e]">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-8 text-xs text-[#77796c] sm:flex-row sm:items-center sm:justify-between">
          <span>AgentOS · OKX.AI Agent Service Provider · A2MCP + A2A</span>
          <span>Swap &amp; Bridge Execution · Agent Email · Agent Phone · Durable events</span>
        </div>
      </footer>
    </main>
  )
}
