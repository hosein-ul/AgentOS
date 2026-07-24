const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "APP_URL",
  "PAYMENT_WALLET",
  "OKX_API_KEY",
  "OKX_SECRET_KEY",
  "OKX_PASSPHRASE",
] as const

export function appUrl() {
  return process.env.APP_URL?.replace(/\/$/, "") ?? ""
}

export function requireProductionConfig() {
  const missing = required.filter((name) => !process.env[name])
  if (missing.length) throw new Error(`Missing required production configuration: ${missing.join(", ")}`)
  if (process.env.PAYMENT_REQUIRED !== "true") throw new Error("PAYMENT_REQUIRED must be true in production")
}

export function isSafeProductionUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === "https:" && !url.username && !url.password
  } catch {
    return false
  }
}
