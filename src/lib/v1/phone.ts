import { requireServerSupabase } from "@/lib/supabase"
import type { Tenant } from "./auth"
import {
  createAgentPhoneAgent,
  createAgentPhoneCall,
  createAgentPhoneNumber,
  configureAgentPhoneWebhook,
  deleteAgentPhoneAgent,
  endAgentPhoneCall,
  getAgentPhoneCall,
  getAgentPhoneNumber,
  getAgentPhoneTranscript,
  newAgentCallbackSecret,
  releaseAgentPhoneNumber,
  requireSafeAgentWebhookUrl,
} from "./agentphone"
import { ApiError, requiredString } from "./http"
import {
  enqueueCallEnd,
  enqueueCallMonitor,
  enqueueNumberLifecycleJobs,
  enqueueProviderAgentCleanup,
  enqueueProviderRenewalReconciliation,
} from "./jobs"
import { entitlementWindow } from "./phone-lifecycle"
import { encryptPhoneSecret } from "./secrets"
import { PHONE_SERVICES, type ServiceCatalogEntry } from "./service-catalog"
import { appUrl, isSafeProductionUrl } from "./config"
import { createDurableEvent } from "./events"

const ACTIVE_NUMBER_STATES = ["active", "renewal_due", "renewal_authorized"]
const ACTIVE_CALL_STATES = ["initiated", "ringing", "in-progress", "active"]
const MAX_PROVIDER_CALL_SECONDS = 30 * 60

type NumberRow = {
  id: string
  tenant_id: string
  phone_number: string
  provider_number_id: string | null
  provider_agent_id: string | null
  provider_sub_account_id: string | null
  lifecycle_status: string
  entitlement_started_at: string | null
  entitlement_expires_at: string | null
  renewal_deadline: string | null
  inbound_seconds_balance: number
  inbound_seconds_reserved: number
  agent_webhook_url: string
  agent_webhook_secret_encrypted: string | null
  provider_webhook_secret_encrypted: string | null
}

function optionalString(body: Record<string, unknown>, field: string, max: number) {
  if (body[field] === undefined || body[field] === null || body[field] === "") return null
  const value = requiredString(body, field, max)
  if (!value) throw new ApiError("invalid_request", `${field} must be a non-empty string of at most ${max} characters`)
  return value
}

function phoneNumberId(body: Record<string, unknown>) {
  const id = requiredString(body, "phoneNumberId", 100)
  if (!id) throw new ApiError("invalid_request", "phoneNumberId is required")
  return id
}

function callId(body: Record<string, unknown>) {
  const id = requiredString(body, "callId", 100)
  if (!id) throw new ApiError("invalid_request", "callId is required")
  return id
}

function publicNumber(row: Record<string, unknown>) {
  return {
    id: row.id,
    phoneNumber: row.phone_number,
    country: row.country,
    status: row.lifecycle_status,
    entitlementStartedAt: row.entitlement_started_at,
    entitlementExpiresAt: row.entitlement_expires_at,
    renewalDeadline: row.renewal_deadline,
    inboundSecondsRemaining: row.inbound_seconds_balance,
    createdAt: row.created_at,
    releasedAt: row.released_at,
  }
}

async function ownedNumber(tenant: Tenant, id: string, activeOnly = true): Promise<NumberRow> {
  let query = requireServerSupabase()
    .from("v1_phone_numbers")
    .select("id,tenant_id,phone_number,provider_number_id,provider_agent_id,provider_sub_account_id,lifecycle_status,entitlement_started_at,entitlement_expires_at,renewal_deadline,inbound_seconds_balance,inbound_seconds_reserved,agent_webhook_url,agent_webhook_secret_encrypted,provider_webhook_secret_encrypted")
    .eq("id", id)
    .eq("tenant_id", tenant.id)
  if (activeOnly) query = query.in("lifecycle_status", ACTIVE_NUMBER_STATES)
  const { data, error } = await query.maybeSingle()
  if (error) throw new Error(`Phone number lookup failed: ${error.message}`)
  if (!data) throw new ApiError("not_found", activeOnly ? "Active phone number not found" : "Phone number not found", 404)
  if (activeOnly && data.entitlement_expires_at && new Date(data.entitlement_expires_at).getTime() <= Date.now()) {
    throw new ApiError("conflict", "Phone number entitlement has expired", 409)
  }
  return data as NumberRow
}

async function cleanupProvisioning(input: {
  numberId?: string
  agentId?: string
  subAccountId?: string | null
}) {
  let numberReleased = !input.numberId
  let agentDeleted = !input.agentId
  if (input.numberId) {
    numberReleased = await releaseAgentPhoneNumber(input.numberId, input.subAccountId)
      .then(() => true)
      .catch(() => false)
  }
  if (input.agentId && numberReleased) {
    agentDeleted = await deleteAgentPhoneAgent(input.agentId, input.subAccountId)
      .then(() => true)
      .catch(() => false)
  }
  return { numberReleased, agentDeleted }
}

export async function purchasePhoneNumber(
  tenant: Tenant,
  body: Record<string, unknown>,
  country: "US" | "CA",
  service: ServiceCatalogEntry
) {
  const agentName = requiredString(body, "agentName", 120)
  if (!agentName) throw new ApiError("invalid_request", "agentName is required")
  const agentWebhookUrl = await requireSafeAgentWebhookUrl(body.agentWebhookUrl)
  const areaCode = optionalString(body, "areaCode", 3)
  if (areaCode && !/^\d{3}$/.test(areaCode)) throw new ApiError("invalid_request", "areaCode must contain exactly three digits")
  const description = optionalString(body, "description", 500)
  const beginMessage = optionalString(body, "beginMessage", 1_000)
  const voice = optionalString(body, "voice", 120)
  const language = optionalString(body, "language", 20)
  const providerSubAccountId = null
  let providerAgentId: string | undefined
  let providerNumberId: string | undefined
  let persistedNumberId: string | undefined
  const callbackSecret = newAgentCallbackSecret()

  try {
    const providerAgent = await createAgentPhoneAgent({
      name: agentName,
      description,
      beginMessage,
      voice,
      language,
    }, providerSubAccountId)
    providerAgentId = providerAgent.id
    const providerWebhookUrl = `${appUrl()}/api/v1/webhooks/agentphone`
    if (!isSafeProductionUrl(providerWebhookUrl)) {
      throw new ApiError("provider_configuration_error", "APP_URL must be a public HTTPS URL before AgentPhone provisioning", 503)
    }
    const providerWebhook = await configureAgentPhoneWebhook(
      providerAgent.id,
      providerWebhookUrl,
      providerSubAccountId,
    )
    const providerNumber = await createAgentPhoneNumber({
      country,
      areaCode,
      agentId: providerAgent.id,
    }, providerSubAccountId)
    providerNumberId = providerNumber.id
    if (!providerNumber.phoneNumber || providerNumber.status === "released") {
      throw new ApiError("provider_error", "AgentPhone did not provision an active phone number", 502)
    }
    const lifecycle = entitlementWindow(providerNumber.createdAt || new Date().toISOString())
    const db = requireServerSupabase()
    const { data, error } = await db
      .from("v1_phone_numbers")
      .insert({
        tenant_id: tenant.id,
        phone_number: providerNumber.phoneNumber,
        provider: "agentphone",
        provider_number_id: providerNumber.id,
        provider_agent_id: providerAgent.id,
        provider_sub_account_id: providerSubAccountId,
        country,
        area_code: areaCode,
        agent_name: agentName,
        agent_webhook_url: agentWebhookUrl,
        agent_webhook_secret_encrypted: encryptPhoneSecret(callbackSecret),
        provider_webhook_secret_encrypted: encryptPhoneSecret(providerWebhook.secret),
        provider_created_at: providerNumber.createdAt,
        entitlement_started_at: lifecycle.startsAt,
        entitlement_expires_at: lifecycle.expiresAt,
        renewal_deadline: lifecycle.renewalDeadline,
        provider_next_charge_at_estimate: lifecycle.expiresAt,
        lifecycle_status: "active",
        active: true,
      })
      .select("*")
      .single()
    if (error || !data) throw new Error(`Phone number persistence failed: ${error?.message ?? "missing row"}`)
    persistedNumberId = data.id
    const { error: entitlementError } = await db.from("v1_phone_entitlements").insert({
      tenant_id: tenant.id,
      phone_number_id: data.id,
      kind: "purchase",
      starts_at: lifecycle.startsAt,
      expires_at: lifecycle.expiresAt,
      fixed_amount: service.amount,
      currency: service.currency,
    })
    if (entitlementError) throw new Error(`Phone entitlement persistence failed: ${entitlementError.message}`)
    await enqueueNumberLifecycleJobs({
      tenantId: tenant.id,
      phoneNumberId: data.id,
      entitlementExpiresAt: lifecycle.expiresAt,
    })
    return {
      ...publicNumber(data as Record<string, unknown>),
      agent: {
        name: agentName,
        mode: "webhook",
        webhookUrl: agentWebhookUrl,
        callbackVerificationSecret: callbackSecret,
        warning: "Store this callback verification secret now. It is shown only once.",
      },
      price: { amount: service.amount, currency: service.currency, entitlementDays: 30 },
      guides: { docs: "/docs#phone", llms: "/llms.txt", openapi: "/openapi.json" },
    }
  } catch (error) {
    const cleanup = await cleanupProvisioning({
      numberId: providerNumberId,
      agentId: providerAgentId,
      subAccountId: providerSubAccountId,
    })
    if (persistedNumberId) {
      const cleanupComplete = cleanup.numberReleased && cleanup.agentDeleted
      await requireServerSupabase().from("v1_phone_numbers").update({
        lifecycle_status: cleanupComplete ? "provisioning_failed" : "provisioning_cleanup_required",
        active: false,
        released_at: cleanup.numberReleased ? new Date().toISOString() : null,
        release_reason: cleanupComplete ? "provisioning_rolled_back" : "provisioning_cleanup_required",
        updated_at: new Date().toISOString(),
      }).eq("id", persistedNumberId).eq("tenant_id", tenant.id)
    }
    throw error
  }
}

export async function renewPhoneNumber(tenant: Tenant, body: Record<string, unknown>) {
  const number = await ownedNumber(tenant, phoneNumberId(body))
  if (!number.entitlement_expires_at) throw new ApiError("conflict", "Phone number has no renewable entitlement", 409)
  const db = requireServerSupabase()
  const { data: renewed, error } = await db.rpc("v1_renew_phone_entitlement", {
    p_tenant_id: tenant.id,
    p_phone_number_id: number.id,
    p_fixed_amount: PHONE_SERVICES.renewNumber30Days.amount,
    p_currency: PHONE_SERVICES.renewNumber30Days.currency,
  })
  if (error) {
    if (/not renewable|future renewal/i.test(error.message)) {
      throw new ApiError("conflict", error.message, 409)
    }
    throw new Error(`Phone renewal failed: ${error.message}`)
  }
  const data = Array.isArray(renewed) ? renewed[0] : renewed
  if (!data) throw new Error("Phone renewal returned no entitlement")
  await enqueueNumberLifecycleJobs({
    tenantId: tenant.id,
    phoneNumberId: number.id,
    entitlementExpiresAt: data.entitlement_expires_at,
  })
  await enqueueProviderRenewalReconciliation({
    tenantId: tenant.id,
    phoneNumberId: number.id,
    providerChargeAtEstimate: data.provider_next_charge_at_estimate,
    entitlementExpiresAt: data.entitlement_expires_at,
  })
  await createDurableEvent({
    tenantId: tenant.id,
    eventKey: `phone:${number.id}:renewed:${data.entitlement_expires_at}`,
    type: "phone.number.renewed",
    service: "phone",
    agentId: data.provider_agent_id ?? undefined,
    resourceType: "phone_number",
    resourceId: number.id,
    payload: {
      phoneNumberId: number.id,
      phoneNumber: number.phone_number,
      entitlementExpiresAt: data.entitlement_expires_at,
      renewedDays: 30,
      fixedPrice: {
        amount: PHONE_SERVICES.renewNumber30Days.amount,
        currency: PHONE_SERVICES.renewNumber30Days.currency,
      },
      source: "agentos.internal",
    },
  })
  return {
    ...publicNumber(data as Record<string, unknown>),
    renewedDays: 30,
    fixedPrice: {
      amount: PHONE_SERVICES.renewNumber30Days.amount,
      currency: PHONE_SERVICES.renewNumber30Days.currency,
    },
  }
}

export async function addInboundMinutes(tenant: Tenant, body: Record<string, unknown>) {
  const number = await ownedNumber(tenant, phoneNumberId(body))
  const db = requireServerSupabase()
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = attempt === 0 ? number : await ownedNumber(tenant, number.id)
    const next = Number(current.inbound_seconds_balance) + 600
    const { data, error } = await db
      .from("v1_phone_numbers")
      .update({ inbound_seconds_balance: next, updated_at: new Date().toISOString() })
      .eq("id", current.id)
      .eq("tenant_id", tenant.id)
      .eq("inbound_seconds_balance", current.inbound_seconds_balance)
      .select("id,phone_number,inbound_seconds_balance")
      .maybeSingle()
    if (error) throw new Error(`Inbound minute purchase failed: ${error.message}`)
    if (data) {
      return {
        phoneNumberId: data.id,
        phoneNumber: data.phone_number,
        addedSeconds: 600,
        addedMinutes: 10,
        inboundSecondsRemaining: data.inbound_seconds_balance,
      }
    }
  }
  throw new ApiError("conflict", "Inbound balance changed concurrently; check the number before retrying", 409)
}

export async function startOutboundCall(
  tenant: Tenant,
  body: Record<string, unknown>,
  service: ServiceCatalogEntry,
  authorizedSeconds: 60 | 300
) {
  const number = await ownedNumber(tenant, phoneNumberId(body))
  const toNumber = requiredString(body, "toNumber", 32)
  if (!toNumber || !/^\+[1-9]\d{6,14}$/.test(toNumber)) {
    throw new ApiError("invalid_request", "toNumber must be an E.164 phone number")
  }
  if (!number.provider_agent_id || !number.provider_number_id) {
    throw new ApiError("conflict", "Phone number is missing AgentPhone routing identifiers", 409)
  }
  const initialGreeting = optionalString(body, "initialGreeting", 1_000)
  const provider = await createAgentPhoneCall({
    agentId: number.provider_agent_id,
    fromNumberId: number.provider_number_id,
    toNumber,
    initialGreeting,
  }, number.provider_sub_account_id)
  const db = requireServerSupabase()
  const { data, error } = await db.from("v1_calls").insert({
    tenant_id: tenant.id,
    phone_number_id: number.id,
    provider: "agentphone",
    provider_call_id: provider.id,
    provider_sub_account_id: number.provider_sub_account_id,
    direction: "outbound",
    status: provider.status,
    from_number: number.phone_number,
    to_number: toNumber,
    agent_webhook_url: number.agent_webhook_url,
    authorized_seconds: authorizedSeconds,
    source_service_id: service.id,
  }).select("id,provider_call_id,status,authorized_seconds,created_at").single()
  if (error || !data) {
    await endAgentPhoneCall(provider.id, number.provider_sub_account_id).catch(() => undefined)
    throw new ApiError("provider_error", "Call started at AgentPhone but could not be persisted; contact support before retrying", 503)
  }
  await enqueueCallMonitor({ tenantId: tenant.id, callId: data.id })
  return {
    id: data.id,
    providerCallId: data.provider_call_id,
    status: data.status,
    authorizedSeconds: data.authorized_seconds,
    timerStarts: "when AgentPhone reports the call as started",
    createdAt: data.created_at,
  }
}

export async function extendActiveCall(tenant: Tenant, body: Record<string, unknown>) {
  const id = callId(body)
  const db = requireServerSupabase()
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data: call, error } = await db
      .from("v1_calls")
      .select("id,tenant_id,status,answered_at,authorized_seconds,authorized_until")
      .eq("id", id)
      .eq("tenant_id", tenant.id)
      .maybeSingle()
    if (error) throw new Error(`Call lookup failed: ${error.message}`)
    if (!call || !ACTIVE_CALL_STATES.includes(call.status) || !call.authorized_until || !call.answered_at) {
      throw new ApiError("conflict", "Call is not active or has not been answered yet", 409)
    }
    const nextSeconds = Number(call.authorized_seconds) + 60
    if (nextSeconds > MAX_PROVIDER_CALL_SECONDS) throw new ApiError("conflict", "AgentPhone limits a call to 30 minutes", 409)
    const nextDeadline = new Date(new Date(call.authorized_until).getTime() + 60_000).toISOString()
    const { data: updated, error: updateError } = await db
      .from("v1_calls")
      .update({
        authorized_seconds: nextSeconds,
        authorized_until: nextDeadline,
        updated_at: new Date().toISOString(),
      })
      .eq("id", call.id)
      .eq("tenant_id", tenant.id)
      .eq("authorized_until", call.authorized_until)
      .select("id,status,authorized_seconds,authorized_until")
      .maybeSingle()
    if (updateError) throw new Error(`Call extension failed: ${updateError.message}`)
    if (updated) {
      await enqueueCallEnd({ tenantId: tenant.id, callId: call.id, authorizedUntil: nextDeadline })
      return {
        callId: updated.id,
        status: updated.status,
        addedSeconds: 60,
        authorizedSeconds: updated.authorized_seconds,
        authorizedUntil: updated.authorized_until,
      }
    }
  }
  throw new ApiError("conflict", "Call was extended concurrently; query the call before retrying", 409)
}

export async function releasePhoneNumber(tenant: Tenant, body: Record<string, unknown>) {
  const id = phoneNumberId(body)
  if (body.confirmRelease !== true) {
    throw new ApiError("invalid_request", "confirmRelease must be true because release is irreversible")
  }
  const number = await ownedNumber(tenant, id, false)
  if (number.lifecycle_status === "released") {
    return { phoneNumberId: number.id, phoneNumber: number.phone_number, status: "released", alreadyReleased: true }
  }
  if (!number.provider_number_id) throw new ApiError("conflict", "Phone number is missing its AgentPhone ID", 409)
  const db = requireServerSupabase()
  await db.from("v1_phone_numbers").update({
    lifecycle_status: "release_pending",
    active: false,
    updated_at: new Date().toISOString(),
  }).eq("id", number.id).eq("tenant_id", tenant.id)
  try {
    await releaseAgentPhoneNumber(number.provider_number_id, number.provider_sub_account_id)
  } catch (error) {
    const provider = await getAgentPhoneNumber(number.provider_number_id, number.provider_sub_account_id).catch(() => null)
    if (provider?.status !== "released") {
      await db.from("v1_phone_numbers").update({ lifecycle_status: "release_failed", updated_at: new Date().toISOString() }).eq("id", number.id)
      throw error
    }
  }
  const releasedAt = new Date().toISOString()
  const { error } = await db.from("v1_phone_numbers").update({
    lifecycle_status: "released",
    active: false,
    released_at: releasedAt,
    release_reason: "agent_requested",
    updated_at: releasedAt,
  }).eq("id", number.id).eq("tenant_id", tenant.id)
  if (error) throw new Error(`Released number persistence failed: ${error.message}`)
  if (number.provider_agent_id) {
    await enqueueProviderAgentCleanup({
      tenantId: tenant.id,
      phoneNumberId: number.id,
      providerAgentId: number.provider_agent_id,
      providerSubAccountId: number.provider_sub_account_id,
    })
  }
  await createDurableEvent({
    tenantId: tenant.id,
    eventKey: `phone:${number.id}:released:${releasedAt}`,
    type: "phone.number.released",
    service: "phone",
    agentId: number.provider_agent_id ?? undefined,
    resourceType: "phone_number",
    resourceId: number.id,
    payload: {
      phoneNumberId: number.id,
      phoneNumber: number.phone_number,
      releasedAt,
      reason: "agent_requested",
      source: "agentos.internal",
    },
  })
  return {
    phoneNumberId: number.id,
    phoneNumber: number.phone_number,
    status: "released",
    releasedAt,
    irreversible: true,
  }
}

export async function listPhoneNumbers(tenant: Tenant, limit = 100) {
  const { data, error } = await requireServerSupabase()
    .from("v1_phone_numbers")
    .select("id,phone_number,country,lifecycle_status,entitlement_started_at,entitlement_expires_at,renewal_deadline,inbound_seconds_balance,created_at,released_at")
    .eq("tenant_id", tenant.id)
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(limit, 200)))
  if (error) throw new Error(`Phone number query failed: ${error.message}`)
  return (data ?? []).map((row) => publicNumber(row as Record<string, unknown>))
}

export async function getCall(tenant: Tenant, id: string) {
  const { data, error } = await requireServerSupabase()
    .from("v1_calls")
    .select("id,phone_number_id,provider_call_id,direction,status,from_number,to_number,started_at,answered_at,ended_at,duration_seconds,authorized_seconds,authorized_until,created_at")
    .eq("id", id)
    .eq("tenant_id", tenant.id)
    .maybeSingle()
  if (error) throw new Error(`Call query failed: ${error.message}`)
  if (!data) throw new ApiError("not_found", "Call not found", 404)
  return {
    id: data.id,
    phoneNumberId: data.phone_number_id,
    direction: data.direction,
    status: data.status,
    fromNumber: data.from_number,
    toNumber: data.to_number,
    startedAt: data.started_at,
    answeredAt: data.answered_at,
    endedAt: data.ended_at,
    durationSeconds: data.duration_seconds,
    authorizedSeconds: data.authorized_seconds,
    authorizedUntil: data.authorized_until,
    createdAt: data.created_at,
  }
}

export async function getCallTranscript(tenant: Tenant, id: string) {
  const { data, error } = await requireServerSupabase()
    .from("v1_calls")
    .select("id,provider_call_id,provider_sub_account_id,transcript,status")
    .eq("id", id)
    .eq("tenant_id", tenant.id)
    .maybeSingle()
  if (error) throw new Error(`Call transcript query failed: ${error.message}`)
  if (!data) throw new ApiError("not_found", "Call not found", 404)
  if (Array.isArray(data.transcript) && data.transcript.length) {
    return { callId: data.id, status: data.status, transcript: data.transcript, source: "event-inbox" }
  }
  if (!data.provider_call_id) return { callId: data.id, status: data.status, transcript: [] }
  const transcript = await getAgentPhoneTranscript(data.provider_call_id, data.provider_sub_account_id)
  return { callId: data.id, status: data.status, transcript, source: "agentphone" }
}

export async function reconcileCallFromProvider(tenant: Tenant, id: string) {
  const db = requireServerSupabase()
  const { data, error } = await db.from("v1_calls")
    .select("id,provider_call_id,provider_sub_account_id")
    .eq("id", id)
    .eq("tenant_id", tenant.id)
    .maybeSingle()
  if (error || !data?.provider_call_id) throw new ApiError("not_found", "Call not found", 404)
  const provider = await getAgentPhoneCall(data.provider_call_id, data.provider_sub_account_id)
  return provider
}
