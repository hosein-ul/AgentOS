"use client"


export default function SettingsPage() {
  const origin = ""

  const aspServices: { path: string; price: string }[] = [
    { path: "/api/asp/mailbox/list", price: "free" },
    { path: "/api/asp/inbox/get", price: "free" },
    { path: "/api/asp/email/get", price: "free" },
    { path: "/api/asp/thread/get", price: "free" },
    { path: "/api/asp/email/mark-read", price: "free" },
    { path: "/api/asp/email/mark-unread", price: "free" },
    { path: "/api/asp/email/archive", price: "free" },
    { path: "/api/asp/email/delete", price: "free" },
    { path: "/api/asp/email/attachments", price: "free" },
    { path: "/api/asp/mailbox/create", price: "$0.25" },
    { path: "/api/asp/email/send", price: "$0.02" },
    { path: "/api/asp/template/send", price: "$0.02" },
    { path: "/api/asp/email/reply", price: "$0.01" },
    { path: "/api/asp/email/reply-all", price: "$0.01" },
    { path: "/api/asp/email/forward", price: "$0.01" },
    { path: "/api/asp/template/send-bulk", price: "$0.05" },
    { path: "/api/asp/mailbox/update", price: "$0.005" },
    { path: "/api/asp/mailbox/delete", price: "$0.005" },
    { path: "/api/asp/email/cancel-scheduled", price: "$0.005" },
    { path: "/api/asp/email/search", price: "$0.005" },
    { path: "/api/asp/template/create", price: "free" },
    { path: "/api/asp/template/list", price: "free" },
    { path: "/api/asp/template/delete", price: "free" },
  ]

  return (
    <div className="max-w-2xl mx-auto px-8 py-8">
      <div className="mb-8">
        <h1 className="font-serif text-3xl">Settings</h1>
        <p className="text-sm text-ink-2 mt-1">Account and integration configuration</p>
      </div>

      <div className="space-y-6">
        {/* Account */}
        <section className="border border-line rounded">
          <div className="px-5 py-3 border-b border-line">
            <p className="text-sm font-medium">Account</p>
          </div>
          <div className="px-5 py-4 space-y-4">
            <div>
              <label className="block text-xs text-ink-2 mb-1.5">Account email</label>
              <input
                type="email"
                value={`demo@${process.env.NEXT_PUBLIC_EMAIL_DOMAIN ?? "localhost"}`}
                disabled
                className="w-full px-3 py-2 text-sm bg-surface-sub border border-line rounded text-ink-2 font-mono"
              />
            </div>
            <div>
              <label className="block text-xs text-ink-2 mb-1.5">Email domain</label>
              <input
                type="text"
                value={process.env.NEXT_PUBLIC_EMAIL_DOMAIN ?? "not configured"}
                disabled
                className="w-full px-3 py-2 text-sm bg-surface-sub border border-line rounded text-ink-2 font-mono"
              />
              <p className="text-xs text-ink-3 mt-1.5">All agent mailboxes use this domain</p>
            </div>
          </div>
        </section>

        {/* Resend */}
        <section className="border border-line rounded">
          <div className="px-5 py-3 border-b border-line">
            <p className="text-sm font-medium">Resend</p>
          </div>
          <div className="px-5 py-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm">API key</p>
                <p className="text-xs text-ink-3 mt-0.5">Set RESEND_API_KEY in .env</p>
              </div>
              <span className="text-xs font-mono text-ink-3 bg-surface-sub px-2 py-1 rounded border border-line">
                not configured
              </span>
            </div>
            <div>
              <p className="text-xs text-ink-2 mb-1.5">Inbound email webhook</p>
              <pre className="text-xs font-mono text-ink bg-surface-sub border border-line rounded px-3 py-2 overflow-x-auto">
                POST {origin}/api/webhooks/inbound
              </pre>
              <p className="text-xs text-ink-3 mt-1.5">
                Add this URL in Resend › Webhooks and subscribe to the{" "}
                <code className="font-mono">email.received</code> event
              </p>
            </div>
            <div>
              <p className="text-xs text-ink-2 mb-1.5">Webhook signing secret</p>
              <p className="text-xs text-ink-3">
                Copy the signing secret from Resend › Webhooks › your endpoint and set{" "}
                <code className="font-mono">RESEND_WEBHOOK_SECRET</code> in .env
              </p>
            </div>
          </div>
        </section>

        {/* OKX.AI */}
        <section className="border border-line rounded">
          <div className="px-5 py-3 border-b border-line">
            <p className="text-sm font-medium">OKX.AI ASP</p>
          </div>
          <div className="px-5 py-4 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm">Service type</p>
              <span className="text-xs font-mono text-amber bg-amber-bg px-2 py-1 rounded">
                A2MCP · x402 pay-per-call
              </span>
            </div>
            <div>
              <p className="text-xs text-ink-2 mb-1.5">Service discovery</p>
              <pre className="text-xs font-mono text-ink bg-surface-sub border border-line rounded px-3 py-2 overflow-x-auto">
                GET {origin}/api/asp
              </pre>
              <p className="text-xs text-ink-3 mt-1.5">
                Each service below is a separate endpoint registered on OKX.AI with its own price (USDT0 on X Layer · eip155:196)
              </p>
            </div>
            <div>
              <p className="text-xs text-ink-2 mb-2">Registered endpoints</p>
              <div className="border border-line rounded divide-y divide-line">
                {aspServices.map((svc) => (
                  <div key={svc.path} className="flex items-center justify-between px-3 py-1.5">
                    <code className="text-xs font-mono text-ink-2">POST {svc.path}</code>
                    <span
                      className={
                        "text-xs font-mono px-2 py-0.5 rounded " +
                        (svc.price === "free"
                          ? "text-ink-3 bg-surface-sub"
                          : "text-amber bg-amber-bg")
                      }
                    >
                      {svc.price}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
