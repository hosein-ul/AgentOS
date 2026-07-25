import Link from "next/link"

const services = [
  { label: "MAIL", title: "A real inbox", provider: "Resend", price: "0.25", detail: "Provision, send, receive, retrieve." },
  { label: "VOICE", title: "A live number", provider: "AgentPhone", price: "7.00 / 30d", detail: "Inbound and outbound conversations controlled by the agent." },
  { label: "EVENTS", title: "A durable signal", provider: "Supabase + WSS", price: "FREE", detail: "Immediate delivery, offline replay, explicit acknowledgement." },
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
            REST infrastructure for autonomous agents
          </div>
          <h1 className="max-w-4xl font-serif text-[clamp(4.3rem,9vw,8.6rem)] leading-[0.82] tracking-[-0.075em]">
            Agents need
            <span className="block text-[#e7ff4f]">a way out.</span>
          </h1>
          <p className="mt-9 max-w-2xl text-lg leading-8 text-[#b9b9ae]">
            AgentOS gives AI agents real email, live phone conversations, and durable events through a wallet-isolated API. Every paid action has one fixed catalog price and one x402 settlement.
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
          <p className="mb-6 font-mono text-[11px] uppercase tracking-[0.22em] text-[#77796c]">First successful operation</p>
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
        <div className="mx-auto grid max-w-7xl md:grid-cols-3">
          {services.map((service, index) => (
            <article key={service.label} className={`group min-h-72 p-7 transition hover:bg-[#1b1d15] ${index > 0 ? "border-t border-[#34362e] md:border-l md:border-t-0" : ""}`}>
              <div className="flex items-start justify-between">
                <span className="font-mono text-[10px] tracking-[0.24em] text-[#e7ff4f]">{service.label}</span>
                <span className="font-mono text-xs text-[#77796c]">{service.price} USDT</span>
              </div>
              <h2 className="mt-16 font-serif text-4xl tracking-[-0.04em]">{service.title}</h2>
              <p className="mt-4 max-w-xs text-sm leading-6 text-[#9b9c90]">{service.detail}</p>
              <p className="mt-7 font-mono text-[10px] uppercase tracking-[0.18em] text-[#5f6156]">Provider / {service.provider}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="relative mx-auto grid max-w-7xl gap-10 px-6 py-20 lg:grid-cols-[0.7fr_1.3fr]">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#e7ff4f]">Machine-first discovery</p>
          <h2 className="mt-5 font-serif text-5xl leading-[0.95] tracking-[-0.05em]">An agent should never have to guess.</h2>
        </div>
        <div className="border border-[#34362e] bg-[#0d0e0b] p-6 font-mono text-sm leading-7 text-[#bdbeaf] shadow-[10px_10px_0_#e7ff4f]">
          <p className="text-[#77796c]">$ curl /api/v1/services/phone.number.us.30d</p>
          <p className="mt-3">serviceId: <span className="text-white">phone.number.us.30d</span></p>
          <p>endpoint: <span className="text-white">POST /api/v1/phone/purchase-us-number-30-days</span></p>
          <p>fixedPrice: <span className="text-[#e7ff4f]">7.00 USDT</span></p>
          <p>startHere: <span className="text-white">true</span></p>
          <p>providerSuccess: <span className="text-white">real_only</span></p>
        </div>
      </section>

      <footer className="relative border-t border-[#34362e]">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-8 text-xs text-[#77796c] sm:flex-row sm:items-center sm:justify-between">
          <span>AgentOS · OKX.AI Agent Service Provider</span>
          <span>Email live · Phone implementation pending production E2E · Domain unavailable</span>
        </div>
      </footer>
    </main>
  )
}
