import { NextResponse } from "next/server"
import { PHONE_SERVICES, SERVICE_CATALOG } from "@/lib/v1/service-catalog"

const jsonBody = (properties: Record<string, unknown>, required: string[] = []) => ({
  required: true,
  content: {
    "application/json": {
      schema: { type: "object", additionalProperties: false, properties, required },
    },
  },
})

const responses = (success = "Operation completed") => ({
  "200": { description: success },
  "201": { description: success },
  "400": { description: "Invalid request" },
  "401": { description: "Bearer token missing or invalid" },
  "402": { description: "OKX x402 payment required", headers: { "PAYMENT-REQUIRED": { schema: { type: "string" } } } },
  "409": { description: "Conflict or idempotency conflict" },
  "428": { description: "ONBOARDING_REQUIRED; no payment was settled" },
  "502": { description: "Real provider operation failed" },
  "503": { description: "Required provider or infrastructure configuration unavailable" },
})

const paidPost = (
  summary: string,
  fixedPrice: string,
  requestBody: ReturnType<typeof jsonBody>,
  authenticated = true,
) => ({
  summary,
  security: authenticated ? [{ bearerAuth: [] }] : [],
  parameters: [
    { in: "header", name: "Idempotency-Key", required: true, schema: { type: "string", maxLength: 255 } },
    { in: "header", name: "PAYMENT-SIGNATURE", required: false, schema: { type: "string" }, description: "Absent on the challenge request; required on the paid replay." },
  ],
  requestBody,
  responses: responses(),
  "x-agentos-fixed-price": `${fixedPrice} USDT`,
  "x-agentos-guide": "/docs",
})

const freeGet = (summary: string, parameters: unknown[] = []) => ({
  summary,
  security: [{ bearerAuth: [] }],
  parameters,
  responses: responses(),
  "x-agentos-fixed-price": "free",
  "x-agentos-guide": "/docs",
})

const string = (description?: string) => ({ type: "string", ...(description ? { description } : {}) })

export async function GET() {
  const document: {
    paths: Record<string, Record<string, Record<string, unknown>>>
    [key: string]: unknown
  } = {
    openapi: "3.1.0",
    info: {
      title: "AgentOS ASP",
      version: "1.0.0",
      description: "Wallet-isolated OKX x402 REST services. The first successful paid business operation returns the no-expiry bearer token at no additional cost. AgentPhone recordings are not collected or exposed.",
    },
    servers: [{ url: process.env.APP_URL ?? "https://your-agentos.example" }],
    externalDocs: { description: "Agent operating guide", url: "/docs" },
    paths: {
      "/api/v1": {
        get: { summary: "Discover services, fixed prices, and guide links", responses: { "200": { description: "Service catalog" } } },
      },
      "/api/v1/services": {
        get: { summary: "List the canonical AgentOS service catalog", responses: { "200": { description: "Canonical service catalog" } } },
      },
      "/api/v1/services/{serviceId}": {
        get: {
          summary: "Get one canonical AgentOS service",
          parameters: [{ in: "path", name: "serviceId", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Service record" }, "404": { description: "Unknown service ID" } },
        },
      },
      "/api/v1/email/mailboxes": {
        post: paidPost("Create a real Resend-backed mailbox", "0.25", jsonBody({
          localPart: string("Mailbox local part"),
          displayName: string(),
          outboundSignature: string(),
        }, ["localPart"]), false),
      },
      "/api/v1/email/mailboxes/query": {
        get: freeGet("List owned mailboxes"),
      },
      "/api/v1/email/mailboxes/update": {
        post: paidPost("Update one owned mailbox", "0.01", jsonBody({
          mailboxId: string(),
          displayName: string(),
          outboundSignature: string(),
          active: { type: "boolean" },
        }, ["mailboxId"])),
      },
      "/api/v1/email/mailboxes/delete": {
        post: paidPost("Delete one owned mailbox", "0.01", jsonBody({ mailboxId: string() }, ["mailboxId"])),
      },
      "/api/v1/email/messages/send": {
        post: paidPost("Send a real email through Resend", "0.02", jsonBody({
          mailboxId: string(),
          to: { type: "array", items: { type: "string", format: "email" } },
          cc: { type: "array", items: { type: "string", format: "email" } },
          bcc: { type: "array", items: { type: "string", format: "email" } },
          subject: string(),
          text: string(),
          html: string(),
        }, ["mailboxId", "to", "subject", "text"])),
      },
      "/api/v1/email/messages/query": {
        get: freeGet("Query owned email messages", [
          { in: "query", name: "mailboxId", schema: { type: "string", format: "uuid" } },
          { in: "query", name: "messageId", schema: { type: "string", format: "uuid" } },
          { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100 } },
        ]),
      },
      [PHONE_SERVICES.purchaseUsNumber30Days.endpoint]: {
        post: paidPost("Purchase a US AgentPhone number for 30 days", PHONE_SERVICES.purchaseUsNumber30Days.amount, jsonBody({
          agentName: string(),
          areaCode: { type: "string", pattern: "^[0-9]{3}$" },
          description: string(),
          beginMessage: string(),
          voice: string(),
          language: string(),
        }, ["agentName"]), false),
      },
      [PHONE_SERVICES.purchaseCanadaNumber30Days.endpoint]: {
        post: paidPost("Purchase a Canadian AgentPhone number for 30 days", PHONE_SERVICES.purchaseCanadaNumber30Days.amount, jsonBody({
          agentName: string(),
          areaCode: { type: "string", pattern: "^[0-9]{3}$" },
          description: string(),
          beginMessage: string(),
          voice: string(),
          language: string(),
        }, ["agentName"]), false),
      },
      [PHONE_SERVICES.renewNumber30Days.endpoint]: {
        post: paidPost("Renew one active number for another 30 days", PHONE_SERVICES.renewNumber30Days.amount, jsonBody({
          phoneNumberId: { type: "string", format: "uuid" },
        }, ["phoneNumberId"])),
      },
      [PHONE_SERVICES.outboundCall1Minute.endpoint]: {
        post: paidPost("Start an outbound call authorized for up to 60 connected seconds", PHONE_SERVICES.outboundCall1Minute.amount, jsonBody({
          phoneNumberId: { type: "string", format: "uuid" },
          toNumber: { type: "string", pattern: "^\\+[1-9][0-9]{6,14}$" },
          initialGreeting: string(),
        }, ["phoneNumberId", "toNumber"])),
      },
      [PHONE_SERVICES.outboundCall5Minutes.endpoint]: {
        post: paidPost("Start an outbound call authorized for up to 300 connected seconds", PHONE_SERVICES.outboundCall5Minutes.amount, jsonBody({
          phoneNumberId: { type: "string", format: "uuid" },
          toNumber: { type: "string", pattern: "^\\+[1-9][0-9]{6,14}$" },
          initialGreeting: string(),
        }, ["phoneNumberId", "toNumber"])),
      },
      [PHONE_SERVICES.extendCall1Minute.endpoint]: {
        post: paidPost("Extend an active answered call by 60 seconds", PHONE_SERVICES.extendCall1Minute.amount, jsonBody({
          callId: { type: "string", format: "uuid" },
        }, ["callId"])),
      },
      [PHONE_SERVICES.addInboundMinutes10.endpoint]: {
        post: paidPost("Add 600 inbound seconds to an owned active number", PHONE_SERVICES.addInboundMinutes10.amount, jsonBody({
          phoneNumberId: { type: "string", format: "uuid" },
        }, ["phoneNumberId"])),
      },
      "/api/v1/phone/release-number": {
        post: {
          summary: "Irreversibly release one owned AgentPhone number",
          security: [{ bearerAuth: [] }],
          requestBody: jsonBody({
            phoneNumberId: { type: "string", format: "uuid" },
            confirmRelease: { type: "boolean", const: true },
          }, ["phoneNumberId", "confirmRelease"]),
          responses: responses(),
          "x-agentos-fixed-price": "free",
          "x-agentos-guide": "/docs#phone",
        },
      },
      "/api/v1/phone/numbers": { get: freeGet("List owned phone numbers and entitlement state") },
      "/api/v1/phone/calls/{callId}": {
        get: freeGet("Read one owned call", [
          { in: "path", name: "callId", required: true, schema: { type: "string", format: "uuid" } },
        ]),
      },
      "/api/v1/phone/calls/{callId}/transcript": {
        get: freeGet("Read the transcript for one owned call", [
          { in: "path", name: "callId", required: true, schema: { type: "string", format: "uuid" } },
        ]),
      },
      "/api/v1/events": {
        get: freeGet("Replay pending durable events", [
          { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 200 } },
        ]),
      },
      "/api/v1/events/realtime-token": { get: freeGet("Get a short-lived RLS-scoped Realtime JWT and replay pending events") },
      "/api/v1/events/list": {
        post: {
          summary: "List durable events with tenant-scoped filters and cursor pagination",
          security: [{ bearerAuth: [] }],
          requestBody: jsonBody({
            status: { type: "string", enum: ["pending", "delivered", "acknowledged", "expired", "failed"] },
            types: { type: "array", items: { type: "string" } },
            agentId: string(),
            service: string(),
            resourceId: string(),
            from: { type: "string", format: "date-time" },
            to: { type: "string", format: "date-time" },
            limit: { type: "integer", minimum: 1, maximum: 100 },
            cursor: string(),
          }),
          responses: responses(),
          "x-agentos-fixed-price": "free",
        },
      },
      "/api/v1/events/get": {
        post: {
          summary: "Get one tenant-owned durable event",
          security: [{ bearerAuth: [] }],
          requestBody: jsonBody({ eventId: { type: "string", format: "uuid" } }, ["eventId"]),
          responses: responses(),
          "x-agentos-fixed-price": "free",
        },
      },
      "/api/v1/events/ack": {
        post: {
          summary: "Idempotently acknowledge one tenant-owned durable event",
          security: [{ bearerAuth: [] }],
          requestBody: jsonBody({ eventId: { type: "string", format: "uuid" } }, ["eventId"]),
          responses: responses(),
          "x-agentos-fixed-price": "free",
        },
      },
      "/api/v1/events/ack-all": {
        post: {
          summary: "Acknowledge matching tenant events up to an explicit cutoff",
          security: [{ bearerAuth: [] }],
          requestBody: jsonBody({
            before: { type: "string", format: "date-time" },
            types: { type: "array", items: { type: "string" } },
            service: string(),
          }, ["before"]),
          responses: responses(),
          "x-agentos-fixed-price": "free",
        },
      },
      "/api/v1/events/{eventId}/acknowledge": {
        post: {
          summary: "Acknowledge a durably handled event",
          security: [{ bearerAuth: [] }],
          parameters: [{ in: "path", name: "eventId", required: true, schema: { type: "string", format: "uuid" } }],
          responses: responses(),
          "x-agentos-fixed-price": "free",
        },
      },
      "/api/v1/domains/register": {
        post: {
          summary: "Disabled until fixed per-TLD services and stable Namecheap egress are configured",
          deprecated: true,
          responses: { "503": { description: "Service intentionally not listed" } },
          "x-agentos-fixed-price": null,
          "x-agentos-guide": "/docs#domains",
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "opaque at_v1 token" },
      },
    },
    "x-agentos-guides": { docs: "/docs", llms: "/llms.txt", openapi: "/openapi.json" },
  }
  for (const service of SERVICE_CATALOG) {
    const operation = document.paths[service.endpoint]?.[service.method.toLowerCase()]
    if (!operation) continue
    operation["x-agentos-service-id"] = service.id
    operation["x-agentos-fixed-price"] = service.paid
      ? `${service.amount} ${service.currency}`
      : "free"
    operation["x-agentos-start-here"] = service.startHere
    operation["x-agentos-available"] = service.available
    operation["x-agentos-register-on-okx"] = service.registerOnOkx
    operation["x-agentos-guide"] = service.guide
  }
  return NextResponse.json(document, {
    headers: { "cache-control": "public, max-age=300" },
  })
}
