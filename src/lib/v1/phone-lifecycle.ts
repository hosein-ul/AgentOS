export const NUMBER_ENTITLEMENT_DAYS = 30
export const REMINDER_DAYS = [5, 3, 1] as const

export function addDays(value: Date | string, days: number) {
  const date = typeof value === "string" ? new Date(value) : new Date(value.getTime())
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid lifecycle date")
  date.setUTCDate(date.getUTCDate() + days)
  return date
}

export function entitlementWindow(providerCreatedAt: string) {
  const startsAt = new Date(providerCreatedAt)
  const expiresAt = addDays(startsAt, NUMBER_ENTITLEMENT_DAYS)
  return {
    startsAt: startsAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    renewalDeadline: expiresAt.toISOString(),
  }
}

export function renewedWindow(currentExpiry: string) {
  const expiresAt = addDays(currentExpiry, NUMBER_ENTITLEMENT_DAYS)
  return {
    startsAt: currentExpiry,
    expiresAt: expiresAt.toISOString(),
    renewalDeadline: expiresAt.toISOString(),
  }
}

export function reminderTimes(expiresAt: string) {
  const expiry = new Date(expiresAt)
  if (!Number.isFinite(expiry.getTime())) throw new Error("Invalid entitlement expiry")
  return REMINDER_DAYS.map((days) => ({
    days,
    runAt: addDays(expiry, -days).toISOString(),
  }))
}

export function isSameInstant(left: string | null | undefined, right: string) {
  if (!left) return false
  return new Date(left).getTime() === new Date(right).getTime()
}
