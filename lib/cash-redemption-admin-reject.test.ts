// Staff rejection of a cash-redemption review.
//
// Releasing a hold moves real money back to spendable, so the expensive
// mistakes are: a non-staff caller reaching the resolver, a double click
// releasing twice, and the ledger being touched. Each has a test that drives
// the real route against a real database.
import assert from "node:assert/strict"
import { execFileSync, spawn } from "node:child_process"
import { register } from "node:module"
import { mock, test } from "node:test"

register("./test-alias-hook.mjs", import.meta.url)
mock.module("server-only", { namedExports: {}, defaultExport: {} })

const { createPgSupabaseClient, sql } = await import("../tests/support/pg-supabase.mjs")

const DB = process.env.RF_CR_REJECT_DB ?? "rf_cr_reject"
const REPO = new URL("..", import.meta.url).pathname
const PSQL = process.env.RF_PSQL ?? "/opt/homebrew/opt/postgresql@16/bin/psql"
const SOCKET = process.env.RF_PGSOCKET ?? "/tmp/rfpg"
execFileSync("bash", [`${REPO}tests/support/build-db.sh`, DB], {
  encoding: "utf8",
  env: { ...process.env, LC_ALL: "C" }
})

const session = { user: null as { id: string; email: string } | null, isAdmin: false }
/** Every privileged RPC the route reaches. Must stay empty for a non-staff caller. */
const rpcCalls: Array<{ fn: string; args: unknown }> = []

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
mock.module("@/lib/supabase/service-role", {
  namedExports: {
    getSupabaseServiceRoleClient: () => {
      const client = createPgSupabaseClient(DB)
      const rpc = client.rpc.bind(client)
      return {
        ...client,
        rpc: (fn: string, args: unknown) => {
          rpcCalls.push({ fn, args })
          return rpc(fn, args)
        }
      }
    }
  }
})

process.env.NEXT_PUBLIC_SITE_URL = "https://realfiction.live"
const { POST, GET } = await import("../app/api/admin/cash-redemptions/route.ts")
const { readCashRedemptionsForStaff } = await import("../lib/announcements/cash-redemption-admin-read.ts")

const STAFF = { id: "11111111-1111-4111-8111-111111111111", email: "staff@realfiction.live" }
const PLAYER = { id: "22222222-2222-4222-8222-222222222222", email: "player@example.com" }
const CLAIMANT = "b1000000-0000-4000-8000-000000000001"

const post = (body: unknown, origin = "https://realfiction.live") =>
  POST(
    new Request("https://realfiction.live/api/admin/cash-redemptions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify(body)
    })
  )

/** Seeds $5 of gift-origin credit and opens a real review. Returns its id. */
function seedOpenRequest(cents = 500) {
  sql(DB, `
    delete from public.email_deliveries;
    delete from public.cash_redemption_requests;
    delete from public.store_credit_lots;
    delete from public.store_credit_ledger;
    insert into auth.users (id,email) values ('${CLAIMANT}','claimant@e.test') on conflict do nothing;
    insert into public.profiles (id,email) values ('${CLAIMANT}','claimant@e.test') on conflict do nothing;
    insert into public.store_credit_lots (user_id,source,original_cents,remaining_cents,currency)
      values ('${CLAIMANT}','gift_card',${cents},${cents},'USD');
    insert into public.store_credit_ledger (user_id,delta_cents,source,source_ref,idempotency_key,note)
      values ('${CLAIMANT}',${cents},'gift_card_redemption','s','s:1','seed');`)
  sql(DB, `select public.request_cash_redemption('${CLAIMANT}')`)
  rpcCalls.length = 0
  return sql(DB, "select id from public.cash_redemption_requests")
}

const frozen = () => Number(sql(DB, `select coalesce(sum(frozen_cents),0) from public.store_credit_lots where user_id='${CLAIMANT}'`))
const ledger = () => Number(sql(DB, `select coalesce(sum(delta_cents),0) from public.store_credit_ledger where user_id='${CLAIMANT}'`))
const remaining = () => Number(sql(DB, `select coalesce(sum(remaining_cents),0) from public.store_credit_lots where user_id='${CLAIMANT}'`))
const closureEmails = () => Number(sql(DB, "select count(*) from public.email_deliveries where template='cash_redemption_closed'"))

/** Run an independent PostgreSQL client, concurrently with other clients. */
function runPsql(statement: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      PSQL,
      ["-h", SOCKET, "-U", "postgres", "-d", DB, "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", statement],
      { env: { ...process.env, LC_ALL: "C" } }
    )
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => { stdout += chunk })
    child.stderr.on("data", (chunk) => { stderr += chunk })
    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim())
      } else {
        reject(new Error(`psql exited ${code}: ${stderr.trim()}`))
      }
    })
  })
}

// ===========================================================================
// A/B/C — authorization
// ===========================================================================

test("A. SIGNED OUT cannot reject, and reaches no RPC", async () => {
  const id = seedOpenRequest()
  session.user = null
  session.isAdmin = false

  const response = await post({ action: "reject", requestId: id, reviewNote: "nope" })
  assert.equal(response.status, 404)
  assert.deepEqual(rpcCalls, [], "a signed-out request reached the service-role RPC")
  assert.equal(frozen(), 500, "the hold was released without authorization")
})

test("B. an ORDINARY authenticated user cannot reject", async () => {
  const id = seedOpenRequest()
  session.user = PLAYER
  session.isAdmin = false

  const response = await post({ action: "reject", requestId: id, reviewNote: "nope" })
  assert.equal(response.status, 404)
  assert.deepEqual(rpcCalls, [], "a customer reached the resolver")
  assert.equal(frozen(), 500)
})

test("C. signed-out and not-staff are INDISTINGUISHABLE", async () => {
  const id = seedOpenRequest()
  session.user = null
  const anonymous = await post({ action: "reject", requestId: id, reviewNote: "note here" })
  session.user = PLAYER
  session.isAdmin = false
  const customer = await post({ action: "reject", requestId: id, reviewNote: "note here" })

  assert.equal(anonymous.status, customer.status)
  assert.deepEqual(await anonymous.json(), await customer.json())
})

test("a HOSTILE ORIGIN is rejected before authorization or RPC", async () => {
  const id = seedOpenRequest()
  session.user = STAFF
  session.isAdmin = true

  for (const origin of ["https://evil.example", "https://realfiction.live.evil.example", "null"]) {
    const response = await post({ action: "reject", requestId: id, reviewNote: "note here" }, origin)
    assert.equal(response.status, 403, `${origin} was accepted`)
  }
  assert.deepEqual(rpcCalls, [], "a cross-origin request reached the resolver")
  assert.equal(frozen(), 500)
})

test("a GET can never change financial state", async () => {
  assert.equal((await GET()).status, 405)
})

// ===========================================================================
// H — validation
// ===========================================================================

test("H. a missing or too-short note is refused, and nothing is released", async () => {
  const id = seedOpenRequest()
  session.user = STAFF
  session.isAdmin = true

  for (const note of [undefined, "", "  ", "ab", "contains\u0000nul"]) {
    const response = await post({ action: "reject", requestId: id, reviewNote: note })
    assert.equal(response.status, 400, `note ${JSON.stringify(note)} was accepted`)
  }
  assert.deepEqual(rpcCalls, [])
  assert.equal(frozen(), 500)
})

test("a malformed request id is refused before the RPC", async () => {
  seedOpenRequest()
  session.user = STAFF
  session.isAdmin = true

  for (const bad of ["", "not-a-uuid", "../../etc", 12345, null]) {
    assert.equal((await post({ action: "reject", requestId: bad, reviewNote: "a note" })).status, 400)
  }
  assert.deepEqual(rpcCalls, [])
})

test("a client cannot name the state or a payout amount", async () => {
  const id = seedOpenRequest()
  session.user = STAFF
  session.isAdmin = true

  for (const field of ["state", "paidOutCents", "paid_out_cents", "frozenCents", "role", "isAdmin"]) {
    const response = await post({ action: "reject", requestId: id, reviewNote: "a note", [field]: "completed" })
    assert.equal(response.status, 400, `${field} was accepted`)
  }
  // And `completed` is not an action this surface offers at all.
  assert.equal((await post({ action: "complete", requestId: id, reviewNote: "a note" })).status, 400)
  assert.deepEqual(rpcCalls, [])
})

// ===========================================================================
// D/I/J/K/L/M — the successful rejection
// ===========================================================================

test("D+I. STAFF can reject, calling the CANONICAL resolver", async () => {
  const id = seedOpenRequest()
  session.user = STAFF
  session.isAdmin = true

  const response = await post({ action: "reject", requestId: id, reviewNote: "Not eligible here" })
  assert.equal(response.status, 200)
  const body = (await response.json()) as { outcome?: string; releasedCents?: number }

  assert.equal(body.outcome, "rejected")
  assert.equal(body.releasedCents, 500)
  // The route calls resolve_cash_redemption and nothing else — no direct UPDATE.
  assert.deepEqual(rpcCalls, [
    {
      fn: "resolve_cash_redemption",
      args: {
        p_request_id: id,
        p_state: "rejected",
        p_note: "Not eligible here",
        p_paid_out_cents: 0
      }
    }
  ])
})

test("J. the hold is released by exactly the frozen amount", async () => {
  const id = seedOpenRequest()
  session.user = STAFF
  session.isAdmin = true
  assert.equal(frozen(), 500)

  await post({ action: "reject", requestId: id, reviewNote: "Releasing the hold" })

  assert.equal(frozen(), 0, "the hold was not released")
  assert.equal(remaining(), 500, "the lot remainder changed")
})

test("K. the LEDGER is not reduced — a rejection is not a payout", async () => {
  const id = seedOpenRequest()
  session.user = STAFF
  session.isAdmin = true
  const before = ledger()

  await post({ action: "reject", requestId: id, reviewNote: "Releasing the hold" })

  assert.equal(ledger(), before, "a rejection moved the ledger")
  assert.equal(ledger(), 500, "the customer lost credit")
  assert.equal(
    Number(sql(DB, `select count(*) from public.store_credit_ledger where user_id='${CLAIMANT}' and source='manual_revoke'`)),
    0,
    "a revoke entry was written — that is the COMPLETED path, not rejection"
  )
})

test("L. the request REMAINS in history as rejected", async () => {
  const id = seedOpenRequest()
  session.user = STAFF
  session.isAdmin = true

  await post({ action: "reject", requestId: id, reviewNote: "Kept for audit" })

  assert.equal(Number(sql(DB, "select count(*) from public.cash_redemption_requests")), 1, "the row was deleted")
  assert.equal(sql(DB, `select state from public.cash_redemption_requests where id='${id}'`), "rejected")
  assert.equal(sql(DB, `select review_note from public.cash_redemption_requests where id='${id}'`), "Kept for audit")
  assert.equal(sql(DB, `select (decided_at is not null)::text from public.cash_redemption_requests where id='${id}'`), "true")
  assert.equal(sql(DB, `select requested_cents from public.cash_redemption_requests where id='${id}'`), "500")
})

test("M. exactly ONE closure email is queued for one real transition", async () => {
  const id = seedOpenRequest()
  session.user = STAFF
  session.isAdmin = true
  assert.equal(closureEmails(), 0)

  await post({ action: "reject", requestId: id, reviewNote: "One email only" })
  assert.equal(closureEmails(), 1, "the customer was not told, or was told twice")
})

test("the admin queue reports the terminal closure delivery state", async () => {
  const id = seedOpenRequest()
  session.user = STAFF
  session.isAdmin = true
  sql(DB, "update public.email_deliveries set delivery_outcome='sent' where template='cash_redemption_received'")

  await post({ action: "reject", requestId: id, reviewNote: "Show terminal state" })
  const queue = await readCashRedemptionsForStaff()

  assert.equal(queue.ok, true)
  if (queue.ok) {
    assert.equal(queue.rows[0].customerNotified, "pending")
  }
})

// ===========================================================================
// N/O — idempotency and concurrency
// ===========================================================================

test("N. a DOUBLE SUBMIT cannot release twice", async () => {
  const id = seedOpenRequest()
  session.user = STAFF
  session.isAdmin = true

  const first = await post({ action: "reject", requestId: id, reviewNote: "First" })
  const second = await post({ action: "reject", requestId: id, reviewNote: "Second" })

  assert.equal(first.status, 200)
  assert.equal(((await first.json()) as { releasedCents?: number }).releasedCents, 500)
  // The second is reported as already closed, NOT as an error.
  assert.equal(second.status, 200)
  assert.equal(((await second.json()) as { outcome?: string }).outcome, "already_closed")

  assert.equal(frozen(), 0)
  assert.equal(ledger(), 500, "the second release moved money")
  assert.equal(closureEmails(), 1, "a duplicate closure email was queued")
})

test("CONCURRENT rejections from two tabs release once", async () => {
  const id = seedOpenRequest()
  session.user = STAFF
  session.isAdmin = true

  const [a, b] = await Promise.all([
    post({ action: "reject", requestId: id, reviewNote: "Tab one" }),
    post({ action: "reject", requestId: id, reviewNote: "Tab two" })
  ])

  const outcomes = [
    ((await a.json()) as { outcome?: string }).outcome,
    ((await b.json()) as { outcome?: string }).outcome
  ].sort()
  assert.deepEqual(outcomes, ["already_closed", "rejected"], `got ${outcomes.join(",")}`)

  assert.equal(frozen(), 0)
  assert.equal(ledger(), 500, "concurrent rejection moved money")
  assert.equal(closureEmails(), 1)
})

test("DATABASE concurrency: two independent clients release once", async () => {
  const id = seedOpenRequest()

  const [a, b] = await Promise.all([
    runPsql(
      `select outcome || '|' || released_cents from public.resolve_cash_redemption('${id}', 'rejected', 'Process one', 0)`
    ),
    runPsql(
      `select outcome || '|' || released_cents from public.resolve_cash_redemption('${id}', 'rejected', 'Process two', 0)`
    )
  ])

  assert.deepEqual([a, b].sort(), ["already_final|0", "rejected|500"])
  assert.equal(frozen(), 0)
  assert.equal(remaining(), 500)
  assert.equal(ledger(), 500)
  assert.equal(closureEmails(), 1)
})

test("O. an ALREADY-CLOSED request is handled without a scary error", async () => {
  const id = seedOpenRequest()
  session.user = STAFF
  session.isAdmin = true
  sql(DB, `select public.resolve_cash_redemption('${id}','rejected','closed elsewhere')`)

  const response = await post({ action: "reject", requestId: id, reviewNote: "Stale tab" })
  assert.equal(response.status, 200, "a stale tab saw an error")
  assert.equal(((await response.json()) as { outcome?: string }).outcome, "already_closed")
  assert.equal(frozen(), 0)
})

test("a request that does not exist reports not found", async () => {
  seedOpenRequest()
  session.user = STAFF
  session.isAdmin = true

  const response = await post({
    action: "reject",
    requestId: "99999999-0000-4000-8000-000000000099",
    reviewNote: "No such review"
  })
  assert.equal(response.status, 404)
})

// ===========================================================================
// R/S/T — what must not exist
// ===========================================================================

test("R+S. NO automatic payout path, and the browser never calls the resolver", async () => {
  const fs = await import("node:fs")
  const route = fs.readFileSync(new URL("../app/api/admin/cash-redemptions/route.ts", import.meta.url), "utf8")
  const client = fs.readFileSync(new URL("../components/admin/cash-redemption-actions.tsx", import.meta.url), "utf8")
  const page = fs.readFileSync(new URL("../app/admin/cash-redemptions/page.tsx", import.meta.url), "utf8")

  // The route may only ever send `rejected`, with a hard-coded zero payout.
  assert.match(route, /p_state: "rejected"/)
  assert.match(route, /p_paid_out_cents: 0/)
  assert.ok(!/"completed"/.test(route), "the route can send `completed`")

  // No direct writes to the financial tables.
  for (const table of ["cash_redemption_requests", "store_credit_lots", "store_credit_ledger"]) {
    assert.ok(!new RegExp(`from\\("${table}"\\)`).test(route), `the route touches ${table} directly`)
  }

  // The browser never names the RPC, and no payout vocabulary exists anywhere.
  for (const source of [client, page]) {
    assert.ok(!/resolve_cash_redemption/.test(source), "the browser references the resolver")
    assert.ok(!/supabase/i.test(source), "the browser imports a Supabase client")
    for (const word of [/payout\(/, /\bpay\b.*\bnow\b/i, /cash out/i, /send money/i]) {
      assert.ok(!word.test(source), `payout vocabulary ${word} present`)
    }
  }
})

test("T. no gift-card secret or credential appears in the response", async () => {
  const id = seedOpenRequest()
  session.user = STAFF
  session.isAdmin = true

  const response = await post({ action: "reject", requestId: id, reviewNote: "Checking leakage" })
  const text = await response.text()

  for (const forbidden of [/verifier/i, /ciphertext/i, /claim_secret/i, /RFG-[A-Z0-9]/, /pepper/i, /sk_(test|live)/]) {
    assert.ok(!forbidden.test(text), `the response leaked ${forbidden}`)
  }
})

test("the manual-SQL admin section is gone", async () => {
  const fs = await import("node:fs")
  const page = fs.readFileSync(new URL("../app/admin/cash-redemptions/page.tsx", import.meta.url), "utf8")

  assert.ok(!/<pre/.test(page), "a SQL snippet remains on the page")
  assert.ok(!/read-only for now/i.test(page), "the read-only notice remains")
  assert.ok(!/resolve_cash_redemption/.test(page), "the page still tells staff to run SQL")
})
