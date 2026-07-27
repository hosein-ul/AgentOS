import "server-only"

import { requireServerSupabase } from "@/lib/supabase"

export async function getTenantDashboardData(tenantId: string | null | undefined) {
  if (!tenantId) {
    return {
      mailboxes: [],
      messages: [],
      numbers: [],
      calls: [],
      payments: [],
      events: [],
      domains: [],
      tokens: [],
    }
  }
  const db = requireServerSupabase()
  const since30Days = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const [mailboxes, messages, numbers, calls, payments, events, domains, tokens] = await Promise.all([
    db.from("v1_mailboxes").select("id,email_address,display_name,active,created_at,updated_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }),
    db.from("v1_messages").select("id,mailbox_id,direction,from_address,to_addresses,subject,status,created_at").eq("tenant_id", tenantId).gte("created_at", since30Days).order("created_at", { ascending: false }).limit(250),
    db.from("v1_phone_numbers").select("id,phone_number,country,provider,lifecycle_status,entitlement_expires_at,inbound_seconds_balance,created_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }),
    db.from("v1_calls").select("id,phone_number_id,direction,status,from_number,to_number,duration_seconds,authorized_seconds,started_at,ended_at,created_at").eq("tenant_id", tenantId).gte("created_at", since30Days).order("created_at", { ascending: false }).limit(250),
    db.from("v1_payments").select("id,service_id,endpoint,amount,currency,created_at").eq("tenant_id", tenantId).gte("created_at", since30Days).order("created_at", { ascending: false }).limit(250),
    db.from("v1_events").select("id,type,resource_type,resource_id,payload,status,created_at,available_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(100),
    db.from("v1_domains").select("id,domain_name,status,expires_at,created_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }),
    db.from("v1_access_tokens").select("id,token_prefix,created_at,last_used_at,revoked_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(100),
  ])
  for (const result of [mailboxes, messages, numbers, calls, payments, events, domains, tokens]) {
    if (result.error) throw new Error(result.error.message)
  }
  return {
    mailboxes: mailboxes.data ?? [],
    messages: messages.data ?? [],
    numbers: numbers.data ?? [],
    calls: calls.data ?? [],
    payments: payments.data ?? [],
    events: events.data ?? [],
    domains: domains.data ?? [],
    tokens: tokens.data ?? [],
  }
}

export async function getAdminDashboardData() {
  const db = requireServerSupabase()
  const [tenants, mailboxes, numbers, calls, payments, events] = await Promise.all([
    db.from("v1_users").select("id,wallet_address,created_at", { count: "exact" }).order("created_at", { ascending: false }).limit(10),
    db.from("v1_mailboxes").select("id", { count: "exact", head: true }),
    db.from("v1_phone_numbers").select("id,lifecycle_status", { count: "exact" }),
    db.from("v1_calls").select("id", { count: "exact", head: true }),
    db.from("v1_payments").select("id", { count: "exact", head: true }),
    db.from("v1_events").select("id,status", { count: "exact" }),
  ])
  for (const result of [tenants, mailboxes, numbers, calls, payments, events]) if (result.error) throw new Error(result.error.message)
  return { tenants: tenants.data ?? [], totals: { tenants: tenants.count ?? 0, mailboxes: mailboxes.count ?? 0, numbers: numbers.count ?? 0, calls: calls.count ?? 0, payments: payments.count ?? 0, pendingEvents: (events.data ?? []).filter((event) => event.status === "pending").length } }
}
