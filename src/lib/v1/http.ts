import { NextResponse } from "next/server"
import { randomUUID } from "crypto"

export type ApiErrorCode =
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "INVALID_REQUEST"
  | "NOT_FOUND"
  | "CONFLICT"
  | "PAYMENT_CONFIGURATION_ERROR"
  | "PROVIDER_CONFIGURATION_ERROR"
  | "PROVIDER_ERROR"

// Fields are declared explicitly rather than as constructor parameter properties
// so this module loads under Node's type-stripping runtime used by the tests.
export class ApiError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

export function requestId() {
  return randomUUID()
}

export function apiData(data: unknown, guide: string, status = 200, id = requestId()) {
  return NextResponse.json({
    data,
    requestId: id,
    guide,
    guides: {
      docs: guide,
      llms: "/llms.txt",
      serviceCatalog: "/api/v1/services",
      openapi: "/openapi.json",
    },
  }, { status })
}

export function apiError(error: unknown, guide: string) {
  const known = error instanceof ApiError
  const code = known ? error.code : "internal_error"
  const message = known ? error.message : "The request could not be completed"
  const status = known ? error.status : 500
  return NextResponse.json({
    error: { code, message, requestId: requestId() },
    guide,
    guides: {
      docs: guide,
      llms: "/llms.txt",
      serviceCatalog: "/api/v1/services",
      openapi: "/openapi.json",
    },
  }, { status })
}

// No v1 operation legitimately needs a large body; the biggest is an email with
// an HTML part. Bounding it here means a self-hosted deployment does not depend
// on a platform request limit.
export const MAX_REQUEST_BODY_BYTES = 1_000_000

export async function readBoundedText(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? "")
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BODY_BYTES) {
    throw new ApiError("payload_too_large", "Request body is too large", 413)
  }
  const raw = await request.text()
  // Content-Length can be absent or wrong, so check what actually arrived.
  if (Buffer.byteLength(raw, "utf8") > MAX_REQUEST_BODY_BYTES) {
    throw new ApiError("payload_too_large", "Request body is too large", 413)
  }
  return raw
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const raw = await readBoundedText(request)
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new ApiError("invalid_request", "Request body must be valid JSON")
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError("invalid_request", "Request body must be a JSON object")
  }
  return value as Record<string, unknown>
}

export function requiredString(body: Record<string, unknown>, field: string, max = 10_000) {
  const value = body[field]
  if (typeof value !== "string" || !value.trim() || value.length > max) return null
  return value.trim()
}
