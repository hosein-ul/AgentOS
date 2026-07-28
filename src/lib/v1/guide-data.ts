import type { ServiceCatalogEntry } from "./service-catalog"

// Pure builder for the machine-readable operation guides.
//
// Deliberately free of Next.js and database imports so it can be unit tested
// directly and so it is structurally impossible for guide generation to execute
// an operation, contact a provider, or settle a payment.

function exampleValue(field: string, hint: string) {
  if (/Id$/.test(field)) return "00000000-0000-0000-0000-000000000000"
  if (field === "to" || field === "cc" || field === "bcc") return ["recipient@example.com"]
  if (field === "toNumber") return "+14155550123"
  if (field === "confirmRelease") return true
  if (field === "before") return new Date().toISOString()
  if (field === "types") return ["phone.call.ended"]
  if (field === "localPart") return "support"
  if (field === "agentName") return "support-agent"
  if (field === "areaCode") return "415"
  if (field === "subject") return "Hello"
  if (field === "text") return "Message body"
  return hint
}

function exampleBody(service: ServiceCatalogEntry) {
  const body: Record<string, unknown> = {}
  for (const [field, hint] of Object.entries(service.requiredInput)) {
    if (service.endpoint.includes(`{${field}}`)) continue
    body[field] = exampleValue(field, hint)
  }
  return body
}

function paymentInstructions(service: ServiceCatalogEntry) {
  if (!service.available) {
    return {
      required: false,
      note: "This service is unavailable. It returns HTTP 503 and never issues an x402 challenge.",
    }
  }
  if (!service.paid) {
    return { required: false, note: "This operation is free. Do not create or submit a payment." }
  }
  return {
    required: true,
    scheme: "okx-x402",
    fixedPrice: service.x402Price,
    amount: service.amount,
    currency: service.currency,
    steps: [
      `Send ${service.method} ${service.endpoint} with the request body.`,
      "AgentOS replies HTTP 402 with a PAYMENT-REQUIRED challenge bound to this exact endpoint and body.",
      "Pay the challenge and replay the identical request with the PAYMENT-SIGNATURE header and the same body.",
      "A changed body invalidates the proof and returns HTTP 409. Replaying the same proof returns the original response without repeating the operation.",
    ],
    note: "Every paid operation requires its own payment. The access token does not prepay anything.",
  }
}

function authentication(service: ServiceCatalogEntry) {
  if (service.startHere) {
    return {
      required: false,
      bootstrap: true,
      note: "Callable without a bearer token. The first successful paid provisioning for a wallet returns the permanent AgentOS access token exactly once; reuse it for Email, Phone and Events.",
    }
  }
  return {
    required: service.authenticated,
    bootstrap: false,
    header: service.authenticated ? "Authorization: Bearer at_v1_..." : null,
    note: service.authenticated
      ? "Requires the AgentOS access token issued by your first paid provisioning operation."
      : "No authentication required.",
  }
}

export function buildOperationGuide(
  service: ServiceCatalogEntry,
  options: { baseUrl?: string; nextService?: ServiceCatalogEntry | null } = {},
) {
  const next = options.nextService ?? null
  const base = options.baseUrl ?? ""
  return {
    guide: true,
    executed: false,
    note: `This is a usage guide. Nothing was executed, no provider was contacted, no payment was created or settled, and no data changed. Send ${service.method} to run the operation.`,
    serviceId: service.id,
    area: service.area,
    method: service.method,
    endpoint: service.endpoint,
    url: base ? `${base}${service.endpoint}` : service.endpoint,
    description: service.description,
    availability: {
      available: service.available,
      registerOnOkx: service.registerOnOkx,
      status: service.available ? "available" : "unavailable",
    },
    authentication: authentication(service),
    price: {
      paid: service.paid,
      amount: service.amount,
      currency: service.currency,
      x402Price: service.x402Price,
    },
    startHere: service.startHere,
    requiredInput: service.requiredInput,
    optionalInput: service.optionalInput,
    exampleRequest: {
      method: service.method,
      url: base ? `${base}${service.endpoint}` : service.endpoint,
      headers: {
        "content-type": "application/json",
        ...(service.authenticated && !service.startHere ? { authorization: "Bearer at_v1_..." } : {}),
      },
      body: exampleBody(service),
    },
    output: service.output,
    commonErrors: service.mainErrors,
    payment: paymentInstructions(service),
    documentation: {
      guide: service.guide,
      docs: "/docs",
      llms: "/llms.txt",
      openapi: "/openapi.json",
      serviceCatalog: "/api/v1/services",
      service: `/api/v1/services/${service.id}`,
    },
    nextService: next
      ? {
          serviceId: next.id,
          method: next.method,
          endpoint: next.endpoint,
          description: next.description,
          price: next.paid ? `${next.amount} ${next.currency}` : "free",
        }
      : null,
  }
}

