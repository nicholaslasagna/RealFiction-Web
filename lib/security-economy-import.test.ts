// EXPLOIT REGRESSION: /api/admin/economy/import must require real staff.
//
// THE VULNERABILITY (RF-01, CRITICAL)
// ==================================
// `authorizeImport` fell through to:
//
//     const user = await getAuthenticatedUser()
//     if (!user) return 401
//     return { ok: true, actorType: "admin", adminUserId: user.id }
//
// Any authenticated account was labelled "admin". The route then called
// `admin_import_economy_balances` with the SERVICE ROLE, which bypasses RLS,
// and the SQL side validates only the SHAPE of the audit fields
// (`_economy_assert_import_actor` checks actor_type is 'admin'|'service' and
// that an admin id is present) — never that the caller IS an admin.
//
// So anyone who could sign up could mint arbitrary in-game economy balances
// and roll back import batches. Self-service registration is the only
// prerequisite.
import assert from "node:assert/strict"
import { register } from "node:module"
import { mock, test } from "node:test"

register("./test-alias-hook.mjs", import.meta.url)
mock.module("server-only", { namedExports: {}, defaultExport: {} })

const session = { user: null as { id: string; email: string } | null, isAdmin: false }
/** Every privileged RPC the route reaches. Must stay empty for a non-admin. */
const rpcCalls: string[] = []

mock.module("@/lib/auth/staff", {
  namedExports: {
    requireStaff: async () =>
      !session.user
        ? { ok: false, reason: "signed_out" }
        : session.isAdmin
          ? { ok: true, userId: session.user.id, email: session.user.email }
          : { ok: false, reason: "not_staff" }
  }
})

mock.module("@/lib/supabase/server", {
  namedExports: {
    getAuthenticatedUser: async () => session.user,
    createSupabaseServerClient: async () => ({
      rpc: async (fn: string) =>
        fn === "is_admin" ? { data: session.isAdmin, error: null } : { data: null, error: null }
    })
  }
})
mock.module("@/lib/supabase/service-role-rest", {
  namedExports: {
    callServiceRoleRpc: async (fn: string) => {
      rpcCalls.push(fn)
      return { data: [], error: null }
    }
  }
})

const { POST } = await import("../app/api/admin/economy/import/route.ts")

const PLAYER = { id: "aaaaaaaa-0000-4000-8000-000000000001", email: "player@example.com" }
const STAFF = { id: "bbbbbbbb-0000-4000-8000-000000000002", email: "staff@realfiction.live" }

/** A real, non-dry-run import that would move money. */
const MINT = {
  operation: "import",
  currencyKey: "realfiction_main",
  importBatchId: "cccccccc-0000-4000-8000-000000000003",
  reason: "security regression test",
  dryRun: false,
  entries: [
    {
      minecraftUuid: "0000000000000000000901fec934c091",
      minecraftUsername: "Attacker",
      targetBalanceMinor: "999999999",
      metadata: {}
    }
  ]
}

const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new Request("https://realfiction.live/api/admin/economy/import", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body)
    })
  )

function reset() {
  rpcCalls.length = 0
}

test("EXPLOIT: an ordinary authenticated player CANNOT mint economy balance", async () => {
  reset()
  session.user = PLAYER
  session.isAdmin = false

  const response = await post(MINT)

  assert.notEqual(response.status, 200, "a non-admin reached a privileged economy mutation")
  assert.deepEqual(
    rpcCalls,
    [],
    `a non-admin invoked privileged RPC(s): ${rpcCalls.join(", ")}`
  )
})

test("EXPLOIT: an ordinary player cannot ROLL BACK an import batch either", async () => {
  reset()
  session.user = PLAYER
  session.isAdmin = false

  const response = await post({
    operation: "rollback",
    currencyKey: "realfiction_main",
    originalImportBatchId: "dddddddd-0000-4000-8000-000000000004",
    rollbackBatchId: "eeeeeeee-0000-4000-8000-000000000005",
    reason: "security regression test",
    dryRun: false
  })

  assert.notEqual(response.status, 200)
  assert.deepEqual(rpcCalls, [], "a non-admin reached the rollback RPC")
})

test("a DRY RUN is equally forbidden to a non-admin", async () => {
  // Dry run still reads privileged data and confirms the endpoint is reachable.
  reset()
  session.user = PLAYER
  session.isAdmin = false

  await post({ ...MINT, dryRun: true })
  assert.deepEqual(rpcCalls, [])
})

test("a signed-out request is refused", async () => {
  reset()
  session.user = null
  session.isAdmin = false

  const response = await post(MINT)
  assert.equal(response.status >= 400, true)
  assert.deepEqual(rpcCalls, [])
})

test("a client cannot assert its own actor type or admin id", async () => {
  reset()
  session.user = PLAYER
  session.isAdmin = false

  await post({ ...MINT, actorType: "service", adminUserId: STAFF.id, actorId: "economy-import-service" })
  assert.deepEqual(rpcCalls, [], "client-supplied actor fields granted privilege")
})

test("REAL STAFF may still perform an import", async () => {
  // The fix must not break the legitimate operator path.
  reset()
  session.user = STAFF
  session.isAdmin = true

  const response = await post(MINT)
  assert.equal(response.status, 200, await response.text())
  assert.deepEqual(rpcCalls, ["admin_import_economy_balances"])
})

test("the service-secret path still works for machine callers", async () => {
  // Unchanged: this is the documented server-to-server entry point.
  reset()
  process.env.ECONOMY_IMPORT_SERVICE_SECRET = "test-only-not-a-real-value"
  session.user = null
  session.isAdmin = false

  const response = await post(MINT, {
    "x-realfiction-economy-import-secret": "test-only-not-a-real-value"
  })

  assert.equal(response.status, 200, await response.text())
  assert.deepEqual(rpcCalls, ["admin_import_economy_balances"])
  delete process.env.ECONOMY_IMPORT_SERVICE_SECRET
})

test("a WRONG service secret is refused and reaches nothing", async () => {
  reset()
  process.env.ECONOMY_IMPORT_SERVICE_SECRET = "test-only-not-a-real-value"
  session.user = PLAYER
  session.isAdmin = false

  const response = await post(MINT, { "x-realfiction-economy-import-secret": "wrong" })
  assert.equal(response.status, 401)
  assert.deepEqual(rpcCalls, [])
  delete process.env.ECONOMY_IMPORT_SERVICE_SECRET
})
