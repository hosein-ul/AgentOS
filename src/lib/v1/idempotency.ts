import { createHash } from "crypto"
import { requireServerSupabase } from "@/lib/supabase"

export function requestHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

export async function beginIdempotentRequest(
  tenantId: string,
  endpoint: string,
  key: string,
  bodyHash: string
) {
  const db = requireServerSupabase()
  const { data: existing, error: lookupError } = await db
    .from("v1_idempotency_keys")
    .select("request_hash,status,response_status,response_body,payment_payload_hash,payment_settlement_header,created_at")
    .eq("tenant_id", tenantId)
    .eq("endpoint", endpoint)
    .eq("idempotency_key", key)
    .maybeSingle()
  if (lookupError) throw new Error(`Idempotency lookup failed: ${lookupError.message}`)
  if (existing) {
    if (existing.request_hash !== bodyHash) return { kind: "conflict" as const }
    if (existing.status === "completed") return {
      kind: "replay" as const,
      status: existing.response_status,
      body: existing.response_body,
      settlementHeader: existing.payment_settlement_header as string | null,
    }
    if (
      !existing.payment_payload_hash
      && new Date(existing.created_at).getTime() < Date.now() - 5 * 60_000
    ) {
      const { error: deleteError } = await db
        .from("v1_idempotency_keys")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("endpoint", endpoint)
        .eq("idempotency_key", key)
        .eq("status", "in_progress")
        .is("payment_payload_hash", null)
      if (deleteError) throw new Error(`Stale idempotency recovery failed: ${deleteError.message}`)
      return beginIdempotentRequest(tenantId, endpoint, key, bodyHash)
    }
    return {
      kind: "in_progress" as const,
      paymentPayloadHash: existing.payment_payload_hash as string | null,
    }
  }
  const { error } = await db.from("v1_idempotency_keys").insert({
    tenant_id: tenantId,
    endpoint,
    idempotency_key: key,
    request_hash: bodyHash,
    status: "in_progress",
  })
  if (error?.code === "23505") {
    return beginIdempotentRequest(tenantId, endpoint, key, bodyHash)
  }
  if (error) throw new Error(`Idempotency reservation failed: ${error.message}`)
  return { kind: "new" as const }
}

export async function bindIdempotentPayment(
  tenantId: string,
  endpoint: string,
  key: string,
  paymentPayloadHash: string,
  settlementHeader: string,
) {
  const { data, error } = await requireServerSupabase()
    .from("v1_idempotency_keys")
    .update({
      payment_payload_hash: paymentPayloadHash,
      payment_settlement_header: settlementHeader,
    })
    .eq("tenant_id", tenantId)
    .eq("endpoint", endpoint)
    .eq("idempotency_key", key)
    .eq("status", "in_progress")
    .select("idempotency_key")
    .maybeSingle()
  if (error || !data) {
    throw new Error(`Paid idempotency binding failed: ${error?.message ?? "reservation missing"}`)
  }
}

export async function completeIdempotentRequest(
  tenantId: string,
  endpoint: string,
  key: string,
  status: number,
  body: unknown,
  paymentPayloadHash: string,
  settlementHeader: string
) {
  const db = requireServerSupabase()
  const { error } = await db.from("v1_idempotency_keys").update({
    status: "completed",
    response_status: status,
    response_body: body,
    payment_payload_hash: paymentPayloadHash,
    payment_settlement_header: settlementHeader,
    completed_at: new Date().toISOString(),
  }).eq("tenant_id", tenantId).eq("endpoint", endpoint).eq("idempotency_key", key)
  if (error) throw new Error(`Idempotency completion failed: ${error.message}`)
}
