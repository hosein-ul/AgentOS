const required = ["AGENTOS_APP_URL", "CRON_SECRET"]
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required`)
}

const baseUrl = process.env.AGENTOS_APP_URL.replace(/\/+$/, "")
const intervalMs = Math.max(1_000, Number(process.env.WORKER_INTERVAL_MS ?? 5_000))
let stopped = false

async function runBatch() {
  const response = await fetch(`${baseUrl}/api/v1/internal/phone-worker`, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    signal: AbortSignal.timeout(25_000),
  })
  if (!response.ok) {
    throw new Error(`Worker batch failed with HTTP ${response.status}: ${await response.text()}`)
  }
  return response.json()
}

async function main() {
  while (!stopped) {
    const startedAt = Date.now()
    try {
      const result = await runBatch()
      console.log(JSON.stringify({ level: "info", at: new Date().toISOString(), result }))
    } catch (error) {
      console.error(JSON.stringify({
        level: "error",
        at: new Date().toISOString(),
        message: error instanceof Error ? error.message : "Worker batch failed",
      }))
    }
    const delay = Math.max(0, intervalMs - (Date.now() - startedAt))
    await new Promise((resolve) => setTimeout(resolve, delay))
  }
}

process.on("SIGTERM", () => { stopped = true })
process.on("SIGINT", () => { stopped = true })
await main()
