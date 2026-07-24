import { randomUUID } from "node:crypto"
import { requireServerSupabase } from "@/lib/supabase"
import { createDurableEvent } from "./events"
import {
  deleteAgentPhoneAgent,
  endAgentPhoneCall,
  getAgentPhoneCall,
  getAgentPhoneNumber,
  releaseAgentPhoneNumber,
} from "./agentphone"
import { isSameInstant, reminderTimes } from "./phone-lifecycle"
import { PHONE_SERVICES } from "./service-catalog"

type JobRow = {
  id: string
  job_key: string
  tenant_id: string | null
  job_type: string
  resource_id: string | null
  payload: Record<string, unknown>
  attempts: number
  max_attempts: number
}

export async function enqueueJob(input: {
  jobKey: string
  tenantId?: string | null
  jobType: string
  resourceType?: string
  resourceId?: string
  payload?: Record<string, unknown>
  runAt: string
}) {
  const { error } = await requireServerSupabase().from("v1_jobs").upsert({
    job_key: input.jobKey,
    tenant_id: input.tenantId ?? null,
    job_type: input.jobType,
    resource_type: input.resourceType ?? null,
    resource_id: input.resourceId ?? null,
    payload: input.payload ?? {},
    run_at: input.runAt,
    status: "pending",
  }, { onConflict: "job_key", ignoreDuplicates: true })
  if (error) throw new Error(`Job enqueue failed: ${error.message}`)
}

export async function enqueueNumberLifecycleJobs(input: {
  tenantId: string
  phoneNumberId: string
  entitlementExpiresAt: string
}) {
  const cycle = new Date(input.entitlementExpiresAt).toISOString()
  await Promise.all([
    ...reminderTimes(cycle).map(({ days, runAt }) => enqueueJob({
      jobKey: `phone:${input.phoneNumberId}:renewal:${cycle}:reminder:${days}`,
      tenantId: input.tenantId,
      jobType: "phone_renewal_reminder",
      resourceType: "phone_number",
      resourceId: input.phoneNumberId,
      payload: { entitlementExpiresAt: cycle, daysBeforeExpiry: days },
      runAt,
    })),
    enqueueJob({
      jobKey: `phone:${input.phoneNumberId}:renewal:${cycle}:release`,
      tenantId: input.tenantId,
      jobType: "phone_release_expired",
      resourceType: "phone_number",
      resourceId: input.phoneNumberId,
      payload: { entitlementExpiresAt: cycle },
      runAt: cycle,
    }),
  ])
}

export async function enqueueProviderRenewalReconciliation(input: {
  tenantId: string
  phoneNumberId: string
  providerChargeAtEstimate: string
  entitlementExpiresAt: string
}) {
  const chargeAt = new Date(input.providerChargeAtEstimate).toISOString()
  await enqueueJob({
    jobKey: `phone:${input.phoneNumberId}:provider-renewal:${chargeAt}`,
    tenantId: input.tenantId,
    jobType: "phone_provider_renewal_reconcile",
    resourceType: "phone_number",
    resourceId: input.phoneNumberId,
    payload: {
      providerChargeAtEstimate: chargeAt,
      entitlementExpiresAt: new Date(input.entitlementExpiresAt).toISOString(),
    },
    runAt: new Date(new Date(chargeAt).getTime() + 2 * 60_000).toISOString(),
  })
}

export async function enqueueProviderAgentCleanup(input: {
  tenantId: string
  phoneNumberId: string
  providerAgentId: string
  providerSubAccountId?: string | null
}) {
  await enqueueJob({
    jobKey: `phone:${input.phoneNumberId}:agent:${input.providerAgentId}:delete`,
    tenantId: input.tenantId,
    jobType: "phone_provider_agent_delete",
    resourceType: "phone_number",
    resourceId: input.phoneNumberId,
    payload: {
      providerAgentId: input.providerAgentId,
      providerSubAccountId: input.providerSubAccountId ?? null,
    },
    runAt: new Date().toISOString(),
  })
}

export async function enqueueCallMonitor(input: {
  tenantId: string
  callId: string
  runAt?: string
}) {
  const requestedAt = input.runAt ? new Date(input.runAt).getTime() : Date.now() + 5_000
  const runAt = new Date(Math.floor(requestedAt / 5_000) * 5_000).toISOString()
  await enqueueJob({
    jobKey: `call:${input.callId}:monitor:${runAt}`,
    tenantId: input.tenantId,
    jobType: "phone_call_monitor",
    resourceType: "call",
    resourceId: input.callId,
    runAt,
  })
}

export async function enqueueCallEnd(input: {
  tenantId: string
  callId: string
  authorizedUntil: string
}) {
  await enqueueJob({
    jobKey: `call:${input.callId}:end:${new Date(input.authorizedUntil).toISOString()}`,
    tenantId: input.tenantId,
    jobType: "phone_call_end",
    resourceType: "call",
    resourceId: input.callId,
    payload: { authorizedUntil: new Date(input.authorizedUntil).toISOString() },
    runAt: input.authorizedUntil,
  })
}

async function completeJob(job: JobRow) {
  const { error } = await requireServerSupabase().from("v1_jobs").update({
    status: "completed",
    completed_at: new Date().toISOString(),
    lease_expires_at: null,
    leased_by: null,
    updated_at: new Date().toISOString(),
  }).eq("id", job.id)
  if (error) throw new Error(`Job completion failed: ${error.message}`)
}

async function retryJob(job: JobRow, error: unknown) {
  const message = error instanceof Error ? error.message.slice(0, 1_000) : "Unknown worker error"
  const dead = job.attempts >= job.max_attempts
  const delaySeconds = Math.min(300, Math.max(5, 2 ** Math.min(job.attempts, 8)))
  const { error: updateError } = await requireServerSupabase().from("v1_jobs").update({
    status: dead ? "dead" : "pending",
    run_at: new Date(Date.now() + delaySeconds * 1000).toISOString(),
    lease_expires_at: null,
    leased_by: null,
    last_error: message,
    updated_at: new Date().toISOString(),
  }).eq("id", job.id)
  if (updateError) throw new Error(`Job retry update failed: ${updateError.message}`)
}

async function renewalReminder(job: JobRow) {
  if (!job.resource_id || !job.tenant_id) return
  const db = requireServerSupabase()
  const { data: number, error } = await db
    .from("v1_phone_numbers")
    .select("id,tenant_id,phone_number,lifecycle_status,entitlement_expires_at,renewal_deadline")
    .eq("id", job.resource_id)
    .eq("tenant_id", job.tenant_id)
    .maybeSingle()
  if (error) throw new Error(`Phone reminder lookup failed: ${error.message}`)
  const cycle = typeof job.payload.entitlementExpiresAt === "string" ? job.payload.entitlementExpiresAt : ""
  if (!number || !isSameInstant(number.entitlement_expires_at, cycle) || !["active", "renewal_due"].includes(number.lifecycle_status)) return
  const days = Number(job.payload.daysBeforeExpiry)
  await db.from("v1_phone_numbers").update({ lifecycle_status: "renewal_due", updated_at: new Date().toISOString() }).eq("id", number.id)
  await createDurableEvent({
    tenantId: number.tenant_id,
    eventKey: `${job.job_key}:event`,
    type: "phone.number.expiring",
    service: "phone",
    resourceType: "phone_number",
    resourceId: number.id,
    payload: {
      phoneNumberId: number.id,
      phoneNumber: number.phone_number,
      expiryTime: number.entitlement_expires_at,
      renewalDeadline: number.renewal_deadline,
      fixedPrice: { amount: PHONE_SERVICES.renewNumber30Days.amount, currency: "USDT" },
      renewalEndpoint: PHONE_SERVICES.renewNumber30Days.endpoint,
      requiredRequestBody: { phoneNumberId: number.id },
      daysBeforeExpiry: days,
      warning: "This number will be suspended and irreversibly released if it is not renewed before the deadline.",
    },
  })
}

async function releaseExpiredNumber(job: JobRow) {
  if (!job.resource_id || !job.tenant_id) return
  const db = requireServerSupabase()
  const cycle = typeof job.payload.entitlementExpiresAt === "string" ? job.payload.entitlementExpiresAt : ""
  const { data: number, error } = await db
    .from("v1_phone_numbers")
    .select("id,tenant_id,phone_number,provider_number_id,provider_agent_id,provider_sub_account_id,lifecycle_status,entitlement_expires_at")
    .eq("id", job.resource_id)
    .eq("tenant_id", job.tenant_id)
    .maybeSingle()
  if (error) throw new Error(`Expired phone lookup failed: ${error.message}`)
  if (!number || !isSameInstant(number.entitlement_expires_at, cycle) || number.lifecycle_status === "released") return
  if (new Date(number.entitlement_expires_at).getTime() > Date.now()) return
  if (!number.provider_number_id) throw new Error("Phone number is missing its AgentPhone ID")
  await db.from("v1_phone_numbers").update({
    lifecycle_status: "release_pending",
    active: false,
    updated_at: new Date().toISOString(),
  }).eq("id", number.id).eq("tenant_id", number.tenant_id)
  if (number.provider_agent_id) {
    await enqueueProviderAgentCleanup({
      tenantId: number.tenant_id,
      phoneNumberId: number.id,
      providerAgentId: number.provider_agent_id,
      providerSubAccountId: number.provider_sub_account_id,
    })
  }
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
  await db.from("v1_phone_numbers").update({
    lifecycle_status: "released",
    active: false,
    released_at: releasedAt,
    release_reason: "entitlement_expired",
    updated_at: releasedAt,
  }).eq("id", number.id).eq("tenant_id", number.tenant_id)
  await createDurableEvent({
    tenantId: number.tenant_id,
    eventKey: `${job.job_key}:event`,
    type: "phone.number.released",
    service: "phone",
    resourceType: "phone_number",
    resourceId: number.id,
    payload: {
      phoneNumberId: number.id,
      phoneNumber: number.phone_number,
      releasedAt,
      reason: "The 30-day AgentOS entitlement expired without renewal.",
    },
  })
}

async function deleteReleasedProviderAgent(job: JobRow) {
  const providerAgentId = typeof job.payload.providerAgentId === "string"
    ? job.payload.providerAgentId
    : ""
  const subAccountId = typeof job.payload.providerSubAccountId === "string"
    ? job.payload.providerSubAccountId
    : null
  if (!providerAgentId) return
  await deleteAgentPhoneAgent(providerAgentId, subAccountId)
}

async function reconcileProviderRenewal(job: JobRow) {
  if (!job.resource_id || !job.tenant_id) return
  const db = requireServerSupabase()
  const expectedExpiry = typeof job.payload.entitlementExpiresAt === "string"
    ? job.payload.entitlementExpiresAt
    : ""
  const { data: number, error } = await db
    .from("v1_phone_numbers")
    .select("id,tenant_id,phone_number,provider_number_id,provider_sub_account_id,lifecycle_status,entitlement_expires_at")
    .eq("id", job.resource_id)
    .eq("tenant_id", job.tenant_id)
    .maybeSingle()
  if (error) throw new Error(`Provider renewal reconciliation lookup failed: ${error.message}`)
  if (!number || !isSameInstant(number.entitlement_expires_at, expectedExpiry)) return
  if (!number.provider_number_id || number.lifecycle_status === "released") return

  const provider = await getAgentPhoneNumber(number.provider_number_id, number.provider_sub_account_id)
  const reconciledAt = new Date().toISOString()
  if (provider.status === "released") {
    await db.from("v1_phone_numbers").update({
      lifecycle_status: "provider_released",
      active: false,
      released_at: reconciledAt,
      release_reason: "provider_released_during_renewal",
      last_provider_reconciled_at: reconciledAt,
      updated_at: reconciledAt,
    }).eq("id", number.id).eq("tenant_id", number.tenant_id)
    await createDurableEvent({
      tenantId: number.tenant_id,
      eventKey: `${job.job_key}:provider-released`,
      type: "phone.number.provider_released",
      service: "phone",
      resourceType: "phone_number",
      resourceId: number.id,
      payload: {
        phoneNumberId: number.id,
        phoneNumber: number.phone_number,
        detectedAt: reconciledAt,
        warning: "AgentPhone reports that this number is no longer active. Contact AgentOS support.",
      },
    })
    return
  }

  await db.from("v1_phone_numbers").update({
    lifecycle_status: "active",
    provider_next_charge_at_estimate: number.entitlement_expires_at,
    last_provider_reconciled_at: reconciledAt,
    updated_at: reconciledAt,
  }).eq("id", number.id).eq("tenant_id", number.tenant_id)
  await createDurableEvent({
    tenantId: number.tenant_id,
    eventKey: `${job.job_key}:confirmed`,
    type: "phone.number.provider_renewal_reconciled",
    service: "phone",
    resourceType: "phone_number",
    resourceId: number.id,
    payload: {
      phoneNumberId: number.id,
      phoneNumber: number.phone_number,
      entitlementExpiresAt: number.entitlement_expires_at,
      reconciledAt,
      providerLimitation: "AgentPhone exposes no explicit renewal endpoint or next-renewal timestamp; active status is the available reconciliation signal.",
    },
  })
}

async function monitorCall(job: JobRow) {
  if (!job.resource_id || !job.tenant_id) return
  const db = requireServerSupabase()
  const { data: call, error } = await db
    .from("v1_calls")
    .select("id,tenant_id,provider_call_id,provider_sub_account_id,status,authorized_seconds,authorized_until")
    .eq("id", job.resource_id)
    .eq("tenant_id", job.tenant_id)
    .maybeSingle()
  if (error) throw new Error(`Call monitor lookup failed: ${error.message}`)
  if (!call || !call.provider_call_id || ["completed", "failed", "ended"].includes(call.status)) return
  const provider = await getAgentPhoneCall(call.provider_call_id, call.provider_sub_account_id)
  const terminal = ["completed", "failed", "ended", "canceled"].includes(provider.status)
  if (terminal) {
    await db.from("v1_calls").update({
      status: provider.status,
      started_at: provider.startedAt ?? null,
      ended_at: provider.endedAt ?? null,
      duration_seconds: provider.durationSeconds ?? null,
      transcript: provider.transcripts ?? [],
      provider_last_checked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", call.id)
    return
  }
  if (provider.startedAt) {
    const currentDeadline = typeof call.authorized_until === "string" ? call.authorized_until : null
    const authorizedUntil = currentDeadline ?? new Date(new Date(provider.startedAt).getTime() + Number(call.authorized_seconds) * 1000).toISOString()
    await db.from("v1_calls").update({
      status: provider.status,
      started_at: provider.startedAt,
      answered_at: provider.startedAt,
      authorized_until: authorizedUntil,
      provider_last_checked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", call.id)
    await enqueueCallEnd({ tenantId: call.tenant_id, callId: call.id, authorizedUntil })
    return
  }
  await enqueueCallMonitor({ tenantId: call.tenant_id, callId: call.id })
}

async function endAuthorizedCall(job: JobRow) {
  if (!job.resource_id || !job.tenant_id) return
  const db = requireServerSupabase()
  const expected = typeof job.payload.authorizedUntil === "string" ? job.payload.authorizedUntil : ""
  const { data: call, error } = await db
    .from("v1_calls")
    .select("id,tenant_id,provider_call_id,provider_sub_account_id,status,authorized_until")
    .eq("id", job.resource_id)
    .eq("tenant_id", job.tenant_id)
    .maybeSingle()
  if (error) throw new Error(`Call deadline lookup failed: ${error.message}`)
  if (!call || !call.provider_call_id || !isSameInstant(call.authorized_until, expected)) return
  if (["completed", "failed", "ended"].includes(call.status)) return
  if (new Date(call.authorized_until).getTime() > Date.now()) return
  await endAgentPhoneCall(call.provider_call_id, call.provider_sub_account_id)
  await db.from("v1_calls").update({
    status: "end-requested",
    termination_requested_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", call.id).eq("tenant_id", call.tenant_id)
}

async function processJob(job: JobRow) {
  if (job.job_type === "phone_renewal_reminder") return renewalReminder(job)
  if (job.job_type === "phone_release_expired") return releaseExpiredNumber(job)
  if (job.job_type === "phone_provider_renewal_reconcile") return reconcileProviderRenewal(job)
  if (job.job_type === "phone_provider_agent_delete") return deleteReleasedProviderAgent(job)
  if (job.job_type === "phone_call_monitor") return monitorCall(job)
  if (job.job_type === "phone_call_end") return endAuthorizedCall(job)
  throw new Error(`Unsupported job type: ${job.job_type}`)
}

async function repairLifecycleJobs(limit = 100) {
  const { data, error } = await requireServerSupabase()
    .from("v1_phone_numbers")
    .select("id,tenant_id,entitlement_expires_at")
    .in("lifecycle_status", ["active", "renewal_due", "renewal_authorized"])
    .not("entitlement_expires_at", "is", null)
    .order("entitlement_expires_at", { ascending: true })
    .limit(Math.max(1, Math.min(limit, 100)))
  if (error) throw new Error(`Lifecycle job reconciliation failed: ${error.message}`)
  await Promise.all((data ?? []).map((number) => enqueueNumberLifecycleJobs({
    tenantId: number.tenant_id,
    phoneNumberId: number.id,
    entitlementExpiresAt: number.entitlement_expires_at,
  })))
}

async function repairCallJobs(limit = 100) {
  const { data, error } = await requireServerSupabase()
    .from("v1_calls")
    .select("id,tenant_id,status,authorized_until")
    .in("status", ["initiated", "ringing", "in-progress", "active", "end-requested"])
    .order("created_at", { ascending: true })
    .limit(Math.max(1, Math.min(limit, 100)))
  if (error) throw new Error(`Call job reconciliation failed: ${error.message}`)
  await Promise.all((data ?? []).map((call) => {
    if (call.authorized_until) {
      return enqueueCallEnd({
        tenantId: call.tenant_id,
        callId: call.id,
        authorizedUntil: call.authorized_until,
      })
    }
    return enqueueCallMonitor({
      tenantId: call.tenant_id,
      callId: call.id,
      runAt: new Date().toISOString(),
    })
  }))
}

export async function runDueJobs(limit = 25, options: { repair?: boolean } = {}) {
  if (options.repair) {
    await Promise.all([repairLifecycleJobs(100), repairCallJobs(100)])
  }
  const workerId = `worker_${randomUUID()}`
  const db = requireServerSupabase()
  const { data, error } = await db.rpc("v1_claim_due_jobs", {
    p_worker_id: workerId,
    p_limit: Math.max(1, Math.min(limit, 100)),
    p_lease_seconds: 120,
  })
  if (error) throw new Error(`Job claim failed: ${error.message}`)
  const jobs = (data ?? []) as JobRow[]
  let completed = 0
  let failed = 0
  for (const job of jobs) {
    try {
      await processJob(job)
      await completeJob(job)
      completed += 1
    } catch (jobError) {
      await retryJob(job, jobError)
      failed += 1
    }
  }
  return { claimed: jobs.length, completed, failed }
}
