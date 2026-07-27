"use client"

export async function responseData<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null) as {
    data?: T
    error?: { message?: string } | string
  } | null
  if (!response.ok) {
    const message = typeof payload?.error === "string"
      ? payload.error
      : payload?.error?.message
    throw new Error(message ?? `Request failed with status ${response.status}`)
  }
  return payload?.data as T
}

export async function dashboardAction<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/dashboard/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  return responseData<T>(response)
}
