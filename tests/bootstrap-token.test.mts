import assert from "node:assert/strict"
import test, { mock } from "node:test"

// The bootstrap access token must be issued exactly once per wallet tenant, even
// under concurrent requests and repeated idempotent replays.
//
// These tests run against an in-memory stand-in for Postgres whose only modelled
// behaviour is the one the guarantee depends on: an UPDATE ... WHERE column IS
// NULL is atomic, so exactly one concurrent caller can observe the transition.
// No real database, provider or payment is involved.

type TenantRow = { id: string; bootstrap_token_issued_at: string | null }

class FakeDatabase {
  tenants: TenantRow[] = [{ id: "tenant-1", bootstrap_token_issued_at: null }]
  issuedTokens: Array<{ tenant_id: string; token_hash: string }> = []
  claimAttempts = 0

  from(table: string) {
    if (table === "v1_users") return this.#tenantQuery()
    if (table === "v1_access_tokens") return this.#tokenQuery()
    throw new Error(`unexpected table ${table}`)
  }

  #tenantQuery() {
    const state: { patch?: Partial<TenantRow>; id?: string; requireNull?: boolean } = {}
    const builder = {
      update: (patch: Partial<TenantRow>) => {
        state.patch = patch
        return builder
      },
      eq: (column: string, value: string) => {
        if (column === "id") state.id = value
        return builder
      },
      is: (column: string, value: null) => {
        if (column === "bootstrap_token_issued_at" && value === null) state.requireNull = true
        return builder
      },
      select: () => builder,
      // The atomic conditional update. Node runs this synchronously inside one
      // microtask, exactly as Postgres would apply it inside one statement.
      maybeSingle: async () => {
        this.claimAttempts += 1
        const row = this.tenants.find((tenant) => tenant.id === state.id)
        if (!row) return { data: null, error: null }
        if (state.requireNull && row.bootstrap_token_issued_at !== null) {
          return { data: null, error: null }
        }
        Object.assign(row, state.patch)
        return { data: { id: row.id }, error: null }
      },
    }
    return builder
  }

  #tokenQuery() {
    return {
      insert: async (row: { tenant_id: string; token_hash: string }) => {
        this.issuedTokens.push(row)
        return { error: null }
      },
    }
  }
}

async function loadAuth(db: FakeDatabase) {
  mock.reset()
  mock.module("@/lib/supabase", {
    namedExports: { requireServerSupabase: () => db },
  })
  return import(`../src/lib/v1/auth.ts?bootstrap=${Math.random()}`)
}

test("the very first bootstrap claim succeeds and issues one token", async () => {
  const db = new FakeDatabase()
  const { claimBootstrapTokenIssuance, issueAccessToken } = await loadAuth(db)

  assert.equal(await claimBootstrapTokenIssuance("tenant-1"), true)
  const issued = await issueAccessToken("tenant-1")

  assert.match(issued.token, /^at_v1_/)
  assert.equal(issued.expiresAt, null, "the bootstrap token has no automatic expiry")
  assert.equal(db.issuedTokens.length, 1)
  assert.notEqual(db.issuedTokens[0].token_hash, issued.token, "only the hash is stored")
})

test("a repeated bootstrap replay never claims a second token", async () => {
  const db = new FakeDatabase()
  const { claimBootstrapTokenIssuance, issueAccessToken } = await loadAuth(db)

  assert.equal(await claimBootstrapTokenIssuance("tenant-1"), true)
  await issueAccessToken("tenant-1")

  // Twenty further replays of the same completed bootstrap request.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    assert.equal(
      await claimBootstrapTokenIssuance("tenant-1"),
      false,
      "a replay must not be allowed to issue another token",
    )
  }
  assert.equal(db.issuedTokens.length, 1, "exactly one credential exists for this wallet")
})

test("two simultaneous bootstrap replays cannot create two access tokens", async () => {
  const db = new FakeDatabase()
  const { claimBootstrapTokenIssuance, issueAccessToken } = await loadAuth(db)

  const [first, second] = await Promise.all([
    claimBootstrapTokenIssuance("tenant-1"),
    claimBootstrapTokenIssuance("tenant-1"),
  ])

  assert.equal(db.claimAttempts, 2, "both requests really did race for the claim")
  assert.deepEqual([first, second].filter(Boolean).length, 1, "exactly one request wins")

  for (const won of [first, second]) if (won) await issueAccessToken("tenant-1")
  assert.equal(db.issuedTokens.length, 1)
})

test("many simultaneous bootstrap requests still yield exactly one token", async () => {
  const db = new FakeDatabase()
  const { claimBootstrapTokenIssuance, issueAccessToken } = await loadAuth(db)

  const results = await Promise.all(
    Array.from({ length: 50 }, () => claimBootstrapTokenIssuance("tenant-1")),
  )

  assert.equal(db.claimAttempts, 50)
  assert.equal(results.filter(Boolean).length, 1, "only one of 50 concurrent callers may issue")

  await Promise.all(results.map((won) => (won ? issueAccessToken("tenant-1") : null)))
  assert.equal(db.issuedTokens.length, 1)
})

test("a tenant that already holds a token cannot bootstrap another", async () => {
  const db = new FakeDatabase()
  // Mirrors the migration backfill for wallets that predate the fix.
  db.tenants[0].bootstrap_token_issued_at = "2026-07-01T00:00:00.000Z"
  const { claimBootstrapTokenIssuance } = await loadAuth(db)

  assert.equal(await claimBootstrapTokenIssuance("tenant-1"), false)
  assert.equal(db.issuedTokens.length, 0)
})

test("the already-issued notice returns no token and points at recovery", async () => {
  const db = new FakeDatabase()
  const { alreadyIssuedAuthentication } = await loadAuth(db)
  const notice = alreadyIssuedAuthentication({ id: "tenant-1", walletAddress: "0xabc" })

  assert.equal(notice.status, "already_issued")
  assert.equal(notice.accessToken, null, "no token and no fabricated replacement")
  assert.equal(notice.walletAddress, "0xabc")
  assert.match(notice.message, /only once/i, "the show-once warning is preserved")
  assert.match(notice.recovery, /dashboard/i, "an explicit rotation path is named")
  assert.equal(notice.guide, "/docs#access-token-recovery")
  assert.doesNotMatch(JSON.stringify(notice), /at_v1_/, "no credential material leaks")
})
