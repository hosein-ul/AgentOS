import { createClient, type SupabaseClient } from "@supabase/supabase-js"

let serverClient: SupabaseClient | null = null

function databaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = (
    process.env.SUPABASE_SERVICE_ROLE_KEY
    ?? process.env.SUPABASE_SERVICE_KEY
  )?.trim()
  if (!url || !key) {
    throw new Error("Server database configuration is incomplete")
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must be a valid HTTPS URL")
  }
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must use HTTPS")
  }
  return { url, key }
}

export function requireServerSupabase() {
  if (!serverClient) {
    const { url, key } = databaseConfig()
    serverClient = createClient(url, key, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    })
  }
  return serverClient
}

// Compatibility for retired legacy routes. The proxy is intentionally lazy so
// importing one of those route modules cannot initialize a privileged client
// during `next build`. New production code must call requireServerSupabase().
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, property) {
    const client = requireServerSupabase()
    const value = Reflect.get(client, property)
    return typeof value === "function" ? value.bind(client) : value
  },
})
