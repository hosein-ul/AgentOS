import { createClient } from "@supabase/supabase-js"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost.invalid"
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY ?? "build-time-placeholder"

// This legacy export exists only while the dashboard is being retired. New
// production routes must call requireServerSupabase() below. Never fall back to
// the public anon key on the server: direct database access must remain denied.
export const supabase = createClient(url, key, {
  auth: { persistSession: false },
})

export function requireServerSupabase() {
  const serverUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY
  if (!serverUrl || !serviceKey) {
    throw new Error("Server database configuration is incomplete")
  }
  return createClient(serverUrl, serviceKey, { auth: { persistSession: false } })
}
