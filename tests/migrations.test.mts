import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"

// Static reproducibility checks for the migration set.
//
// These do not replace applying the migrations to a real empty database, which
// remains a deployment step. They do catch the failure that actually occurred
// here: a migration that depends on an object no earlier repository migration
// creates, because that object only existed in production.

const dir = join(process.cwd(), "supabase/migrations")
const files = readdirSync(dir).filter((name) => name.endsWith(".sql")).sort()
const sql = new Map(files.map((name) => [name, readFileSync(join(dir, name), "utf8")]))

const VERSION = /^(\d{14})_([a-z0-9_]+)\.sql$/

// Versions recorded in the production database, in applied order.
const PRODUCTION_APPLIED = [
  "20260715060100_init_agentmail",
  "20260724105651_agentos_v1",
  "20260724105706_agentphone_phone_lifecycle",
  "20260724105725_unified_durable_events",
  "20260724105855_foreign_key_indexes",
  "20260724110457_gateway_only_event_access",
  "20260724222712_dashboard_wallet_sessions",
]

function strip(source: string) {
  return source.replace(/--[^\n]*/g, "").replace(/\$\$[\s\S]*?\$\$/g, " ")
}

test("every migration filename is a full 14-digit timestamp", () => {
  for (const name of files) {
    assert.match(name, VERSION, `${name} must be <14-digit-timestamp>_<name>.sql`)
  }
})

test("migration versions are unique and sort into applied order", () => {
  const versions = files.map((name) => name.match(VERSION)![1])
  assert.equal(new Set(versions).size, versions.length, "duplicate migration versions")
  assert.deepEqual([...versions].sort(), versions, "filenames must sort into apply order")
})

test("every schema change applied in production exists in the repository", () => {
  for (const applied of PRODUCTION_APPLIED) {
    assert.ok(
      files.includes(`${applied}.sql`),
      `${applied} is applied in production but missing from supabase/migrations`,
    )
  }
})

test("already-applied migrations keep the versions production recorded", () => {
  const repoVersions = files.map((name) => name.replace(/\.sql$/, ""))
  for (const [index, applied] of PRODUCTION_APPLIED.entries()) {
    assert.equal(
      repoVersions[index],
      applied,
      "an already-applied migration must not be renumbered or reordered",
    )
  }
})

test("new migrations are forward-only additions after the applied history", () => {
  const newOnes = files.map((name) => name.replace(/\.sql$/, "")).slice(PRODUCTION_APPLIED.length)
  const latestApplied = PRODUCTION_APPLIED[PRODUCTION_APPLIED.length - 1].slice(0, 14)
  for (const migration of newOnes) {
    assert.ok(migration.slice(0, 14) > latestApplied, `${migration} must sort after the applied history`)
  }
})

test("no migration depends on an object an earlier migration does not create", () => {
  const created = new Set<string>()
  const quoted = (name: string) => name.replace(/"/g, "").toLowerCase()

  for (const name of files) {
    const source = strip(sql.get(name)!)

    // Objects this migration references but does not create.
    const referenced = new Set<string>()
    for (const match of source.matchAll(/\b(?:alter table|create index[^\n]*?\bon|create unique index[^\n]*?\bon|references)\s+(?:if not exists\s+)?(?:only\s+)?((?:public\.)?"?[A-Za-z_][A-Za-z0-9_]*"?)/gi)) {
      referenced.add(quoted(match[1]).replace(/^public\./, ""))
    }

    for (const match of source.matchAll(/create table(?:\s+if not exists)?\s+((?:public\.)?"?[A-Za-z_][A-Za-z0-9_]*"?)/gi)) {
      created.add(quoted(match[1]).replace(/^public\./, ""))
    }

    for (const target of referenced) {
      assert.ok(
        created.has(target),
        `${name} references "${target}" before any earlier migration creates it`,
      )
    }
  }

  // The legacy tables the foreign-key index migration depends on.
  for (const legacy of ["attachment", "emailtemplate"]) {
    assert.ok(created.has(legacy), `legacy table ${legacy} must be created by a repository migration`)
  }
})

test("the legacy AgentMail schema is retained and documented as unused", () => {
  const legacy = sql.get("20260715060100_init_agentmail.sql")
  assert.ok(legacy, "the legacy migration must exist so a fresh database matches production")
  assert.match(legacy!, /retained/i)
  assert.match(legacy!, /foreign_key_indexes/, "it explains why it cannot simply be dropped")
  assert.match(readFileSync(join(process.cwd(), "docs.md"), "utf8"), /Retained legacy schema/)
})

test("the retired webhook columns are kept nullable, not dropped", () => {
  const migration = sql.get("20260727203201_live_voice_websocket.sql")!
  assert.match(migration, /alter column agent_webhook_url drop not null/)
  assert.doesNotMatch(migration, /drop column/, "dropping would break earlier migrations")
  assert.match(migration, /comment on column/, "the retired columns are labelled in the database")
  assert.match(readFileSync(join(process.cwd(), "docs.md"), "utf8"), /Retained legacy columns/)
})

test("the inbound-call signature change is expand/contract, not a breaking drop", () => {
  const expand = sql.get("20260727203201_live_voice_websocket.sql")!
  // Compare the declared signature, not the surrounding prose.
  const signature = strip(expand).slice(
    strip(expand).indexOf("create or replace function"),
    strip(expand).indexOf("returns public.v1_calls"),
  )
  assert.match(signature, /public\.v1_reserve_inbound_call/)
  assert.doesNotMatch(signature, /p_agent_webhook_url/, "the new overload drops the callback URL")
  // The eight-argument one is NOT dropped in the same migration, because the
  // previously deployed application still calls it.
  assert.doesNotMatch(strip(expand), /drop\s+function/i, "dropping here would break the deployed app")
  assert.match(expand, /EXPAND phase/)

  const contract = sql.get("20260727203500_drop_legacy_reserve_inbound_call.sql")!
  assert.match(contract, /drop function if exists public\.v1_reserve_inbound_call\(\s*uuid, uuid, text, text, timestamptz, text, text, text\s*\)/)
  assert.match(contract, /DO NOT APPLY/, "the ordering constraint must be explicit")
})

test("a contract migration sorts after the expand migration it depends on", () => {
  // The contract phase drops the old overload. If it sorted first it would run
  // before the replacement overload exists, so a fresh database would be left
  // with no v1_reserve_inbound_call at all.
  const expand = files.find((name) => name.includes("live_voice_websocket"))
  const contract = files.find((name) => name.includes("drop_legacy_reserve_inbound_call"))
  assert.ok(expand && contract, "both phases must exist")
  assert.ok(
    contract! > expand!,
    `${contract} must sort after ${expand}, or the drop runs before the replacement is created`,
  )

  // Whatever a contract migration drops, some earlier migration must create.
  for (const name of files) {
    for (const match of strip(sql.get(name)!).matchAll(/drop function if exists\s+public\.(\w+)/gi)) {
      const fn = match[1]
      const createdEarlier = files
        .filter((candidate) => candidate < name)
        .some((candidate) => new RegExp(`create or replace function\\s+public\\.${fn}\\b`, "i").test(sql.get(candidate)!))
      assert.ok(createdEarlier, `${name} drops public.${fn} but no earlier migration creates it`)
    }
  }
})

test("privileged functions stay service-role only", () => {
  for (const name of files) {
    const source = sql.get(name)!
    for (const match of source.matchAll(/create or replace function\s+public\.(\w+)/gi)) {
      const fn = match[1]
      assert.match(source, new RegExp(`revoke all on function public\\.${fn}`, "i"), `${fn} must revoke public execute`)
      assert.match(source, new RegExp(`grant execute on function public\\.${fn}[\\s\\S]*?to service_role`, "i"), `${fn} must grant only service_role`)
    }
  }
})

test("new tables enable RLS and revoke browser-role grants", () => {
  for (const name of files.slice(PRODUCTION_APPLIED.length - 1)) {
    const source = sql.get(name)!
    for (const match of source.matchAll(/create table if not exists public\.(\w+)/gi)) {
      const table = match[1]
      assert.match(source, new RegExp(`alter table public\\.${table} enable row level security`, "i"), `${table} needs RLS`)
      assert.match(source, new RegExp(`revoke all on table public\\.${table} from anon, authenticated`, "i"), `${table} must not be browser-readable`)
    }
  }
})
