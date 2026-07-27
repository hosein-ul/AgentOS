import "server-only"

import { createHmac, createHash, randomBytes, timingSafeEqual } from "crypto"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { recoverMessageAddress } from "viem"
import { requireServerSupabase } from "@/lib/supabase"
import { appUrl } from "@/lib/v1/config"

const COOKIE_NAME = "agentos_dashboard_session"
const SESSION_TTL_SECONDS = 60 * 60 * 12
const NONCE_TTL_MINUTES = 10

export type DashboardSession = { tenantId?: string; walletAddress: string; expiresAt: number }

function sessionSecret() {
  const value = process.env.DASHBOARD_SESSION_SECRET
  if (!value || value.length < 32) throw new Error("DASHBOARD_SESSION_SECRET must be set to at least 32 random characters")
  return value
}

function sha256(value: string) { return createHash("sha256").update(value).digest("hex") }
function normalizeWallet(value: string) {
  const wallet = value.trim().toLowerCase()
  return /^0x[a-f0-9]{40}$/.test(wallet) ? wallet : null
}
function encode(value: object) { return Buffer.from(JSON.stringify(value)).toString("base64url") }
function decode<T>(value: string): T | null {
  try { return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T } catch { return null }
}

// The signed origin comes from canonical configuration, never from a request
// Host header, so a spoofed Host cannot mint a signature for another origin.
export function dashboardOrigin(requestOrigin?: string) {
  const canonical = appUrl()
  if (canonical) return canonical
  if (process.env.NODE_ENV === "production") {
    throw new Error("APP_URL must be configured before dashboard sign-in")
  }
  return requestOrigin ?? "http://localhost:3000"
}

export function dashboardMessage(walletAddress: string, nonce: string, origin: string) {
  return [
    "AgentOS Dashboard sign-in",
    "",
    "Sign this message to prove wallet ownership. It creates no blockchain transaction and costs no gas.",
    `Wallet: ${walletAddress}`,
    `Origin: ${origin}`,
    `Nonce: ${nonce}`,
  ].join("\n")
}

export async function createDashboardNonce(walletAddress: string, origin: string) {
  const wallet = normalizeWallet(walletAddress)
  if (!wallet) throw new Error("A valid EVM wallet address is required")
  const nonce = randomBytes(32).toString("base64url")
  const expiresAt = new Date(Date.now() + NONCE_TTL_MINUTES * 60_000)
  const { error } = await requireServerSupabase().from("v1_dashboard_nonces").insert({
    wallet_address: wallet, nonce_hash: sha256(nonce), expires_at: expiresAt.toISOString(),
  })
  if (error) throw new Error(`Could not create dashboard nonce: ${error.message}`)
  return { nonce, expiresAt: expiresAt.toISOString(), message: dashboardMessage(wallet, nonce, origin) }
}

export async function verifyDashboardSignature(input: { walletAddress: string; nonce: string; signature: string; origin: string }) {
  const wallet = normalizeWallet(input.walletAddress)
  if (!wallet || !input.nonce || !/^0x[0-9a-fA-F]{130}$/.test(input.signature)) throw new Error("Invalid dashboard sign-in request")
  const db = requireServerSupabase()
  const { data: nonce, error } = await db
    .from("v1_dashboard_nonces")
    .select("id,wallet_address,expires_at,consumed_at")
    .eq("nonce_hash", sha256(input.nonce))
    .maybeSingle()
  if (error || !nonce || nonce.wallet_address !== wallet || nonce.consumed_at || new Date(nonce.expires_at).getTime() <= Date.now()) {
    throw new Error("This sign-in request has expired. Please request a new one.")
  }
  const signer = (await recoverMessageAddress({ message: dashboardMessage(wallet, input.nonce, input.origin), signature: input.signature as `0x${string}` })).toLowerCase()
  if (signer !== wallet) throw new Error("The signature does not belong to this wallet")
  const { data: consumed, error: consumeError } = await db.from("v1_dashboard_nonces")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", nonce.id).is("consumed_at", null).gt("expires_at", new Date().toISOString()).select("id").maybeSingle()
  if (consumeError || !consumed) throw new Error("This sign-in request was already used. Please request a new one.")
  const { data: tenant, error: tenantError } = await db.from("v1_users").select("id,wallet_address").eq("wallet_address", wallet).maybeSingle()
  if (tenantError) throw new Error("Could not look up wallet ownership")
  return { tenantId: tenant?.id, walletAddress: tenant?.wallet_address ?? wallet }
}

export async function setDashboardSession(session: Omit<DashboardSession, "expiresAt">) {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
  const payload = encode({ ...session, expiresAt })
  const signature = createHmac("sha256", sessionSecret()).update(payload).digest("base64url")
  const store = await cookies()
  store.set(COOKIE_NAME, `${payload}.${signature}`, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SESSION_TTL_SECONDS })
}

export async function clearDashboardSession() {
  const store = await cookies()
  store.set(COOKIE_NAME, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 })
}

export async function getDashboardSession(): Promise<DashboardSession | null> {
  const raw = (await cookies()).get(COOKIE_NAME)?.value
  if (!raw) return null
  const [payload, signature] = raw.split(".")
  if (!payload || !signature) return null
  const expected = createHmac("sha256", sessionSecret()).update(payload).digest("base64url")
  const actualBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null
  const session = decode<DashboardSession>(payload)
  if (!session || !normalizeWallet(session.walletAddress) || session.expiresAt <= Math.floor(Date.now() / 1000)) return null
  return session
}

export async function requireDashboardSession() {
  const session = await getDashboardSession()
  if (!session) redirect("/login")
  return session
}
