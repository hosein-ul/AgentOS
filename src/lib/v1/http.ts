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
  | "IDEMPOTENCY_CONFLICT"

export class ApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) { super(message) }
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

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await request.json()
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : (() => { throw new ApiError("invalid_request", "Request body must be a JSON object") })()
  } catch {
    throw new ApiError("invalid_request", "Request body must be valid JSON")
  }
}

export function requiredString(body: Record<string, unknown>, field: string, max = 10_000) {
  const value = body[field]
  if (typeof value !== "string" || !value.trim() || value.length > max) return null
  return value.trim()
}
