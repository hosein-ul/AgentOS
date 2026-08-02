import { createHash, randomBytes, timingSafeEqual } from "crypto"
import type { NextRequest } from "next/server"
import { requireServerSupabase } from "@/lib/supabase"
import { ApiError } from "./http"

export interface Tenant {
  id: string
  walletAddress: string
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex")
}

function normalizeWallet(value: string) {
  const wallet = value.trim().toLowerCase()
  return /^0x[a-f0-9]{40}$/.test(wallet) ? wallet : null
}

export async function getOrCreateTenant(walletAddress: string): Promise<Tenant> {
  const wallet = normalizeWallet(walletAddress)
  if (!wallet) throw new ApiError("invalid_payment", "Payment did not contain a valid EVM payer address", 402)
  const db = requireServerSupabase()
  const { data: existing, error: findError } = await db
    .from("v1_users")
    .select("id,wallet_address")
    .eq("wallet_address", wallet)
    .maybeSingle()
  if (findError) throw new Error(`Database lookup failed: ${findError.message}`)
  if (existing) return { id: existing.id, walletAddress: existing.wallet_address }

  const { data, error } = await db
    .from("v1_users")
    .insert({ wallet_address: wallet })
    .select("id,wallet_address")
    .single()
  if (error) throw new Error(`Tenant creation failed: ${error.message}`)
  return { id: data.id, walletAddress: data.wallet_address }
}

/**
 * Look up an existing tenant by its verified payment wallet. Returns null when
 * the wallet has never provisioned an AgentOS resource; a paid call from an
 * unknown wallet still has to go through startHere onboarding before it can
 * touch other services.
 *
 * Used by the paid path so an x402 client that has no way to attach a bearer
 * header (the OKX buyer flow) can still be recognized as onboarded when the
 * signed payer wallet matches an existing tenant.
 */
export async function findTenantByWallet(walletAddress: string): Promise<Tenant | null> {
  const wallet = normalizeWallet(walletAddress)
  if (!wallet) return null
  const { data, error } = await requireServerSupabase()
    .from("v1_users")
    .select("id,wallet_address")
    .eq("wallet_address", wallet)
    .maybeSingle()
  if (error || !data) return null
  return { id: data.id, walletAddress: data.wallet_address }
}

export async function getTenantById(tenantId: string): Promise<Tenant> {
  const { data, error } = await requireServerSupabase()
    .from("v1_users")
    .select("id,wallet_address")
    .eq("id", tenantId)
    .maybeSingle()
  if (error || !data) throw new ApiError("auth_required", "Payment tenant could not be resolved", 401)
  return { id: data.id, walletAddress: data.wallet_address }
}

/**
 * Claim the one-time right to issue this tenant's bootstrap access token.
 *
 * The conditional update is the concurrency control: exactly one caller can flip
 * bootstrap_token_issued_at from NULL, so simultaneous bootstrap requests and
 * idempotent replays cannot mint more than one permanent credential.
 */
export async function claimBootstrapTokenIssuance(tenantId: string) {
  const { data, error } = await requireServerSupabase()
    .from("v1_users")
    .update({ bootstrap_token_issued_at: new Date().toISOString() })
    .eq("id", tenantId)
    .is("bootstrap_token_issued_at", null)
    .select("id")
    .maybeSingle()
  if (error) throw new Error(`Bootstrap token claim failed: ${error.message}`)
  return Boolean(data)
}

/**
 * What a caller is told when the bootstrap token was already issued. No plaintext
 * token is stored, so AgentOS cannot and does not return a replacement here.
 */
export function alreadyIssuedAuthentication(tenant: Tenant) {
  return {
    status: "already_issued" as const,
    accessToken: null,
    walletAddress: tenant.walletAddress,
    message: "This wallet's AgentOS access token was already issued and is shown only once. Reuse the stored token across Email, Phone and Events.",
    recovery: "Lost the token? Sign in at /dashboard with this wallet and issue a replacement, then revoke the old one.",
    guide: "/docs#access-token-recovery",
  }
}

export async function issueAccessToken(tenantId: string) {
  const token = `at_v1_${randomBytes(32).toString("base64url")}`
  const expiresAt = null
  const db = requireServerSupabase()
  const { error } = await db.from("v1_access_tokens").insert({
    tenant_id: tenantId,
    token_hash: tokenHash(token),
    token_prefix: token.slice(0, 12),
    expires_at: expiresAt,
  })
  if (error) throw new Error(`Token issuance failed: ${error.message}`)
  return { token, expiresAt }
}

export async function requireTenant(request: NextRequest): Promise<Tenant> {
  const header = request.headers.get("authorization")
  if (!header?.startsWith("Bearer at_v1_")) throw new ApiError("auth_required", "Bearer access token is required", 401)
  const raw = header.slice(7).trim()
  const db = requireServerSupabase()
  const { data, error } = await db
    .from("v1_access_tokens")
    .select("token_hash,expires_at,revoked_at,tenant:v1_users!inner(id,wallet_address)")
    .eq("token_hash", tokenHash(raw))
    .maybeSingle()
  if (error || !data || data.revoked_at || (data.expires_at && new Date(data.expires_at).getTime() <= Date.now())) throw new ApiError("auth_required", "Access token is invalid or revoked", 401)
  const expected = Buffer.from(data.token_hash, "hex")
  const actual = Buffer.from(tokenHash(raw), "hex")
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new ApiError("auth_required", "Access token is invalid", 401)
  void db.from("v1_access_tokens").update({ last_used_at: new Date().toISOString() }).eq("token_hash", data.token_hash)
  const tenant = data.tenant as unknown as { id: string; wallet_address: string }
  return { id: tenant.id, walletAddress: tenant.wallet_address }
}

export function assertPaymentTenant(tenant: Tenant, payer: string | undefined) {
  const wallet = payer ? normalizeWallet(payer) : null
  if (!wallet || wallet !== tenant.walletAddress) throw new ApiError("forbidden", "Payment wallet does not match the access token wallet", 403)
}
