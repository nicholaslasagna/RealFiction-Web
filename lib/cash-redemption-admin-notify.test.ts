// The admin notification for a cash-redemption review.
//
// THE DEFECT THIS COVERS
// ======================
// A customer could freeze real money by opening a review and no operator was
// told. The request row was always correct; nobody knew it existed.
//
// The email is a NOTIFICATION. The admin page reads the request table directly,
// so a provider failure delays the alert and never hides the request — that
// separation is asserted here too.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { register } from "node:module"
import { mock, test } from "node:test"

register("./test-alias-hook.mjs", import.meta.url)
mock.module("server-only", { namedExports: {}, defaultExport: {} })

const { createPgSupabaseClient, sql } = await import("../tests/support/pg-supabase.mjs")

const DB = process.env.RF_CR_ADMIN_DB ?? "rf_cr_admin"
const REPO = new URL("..", import.meta.url).pathname
execFileSync("bash", [`${REPO}tests/support/build-db.sh`, DB], {
  encoding: "utf8",
  env: { ...process.env, LC_ALL: "C" }
})

const session = { user: null as { id: string; email: string } | null, isAdmin: false }
const serviceRoleCalls: string[] = []

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
      serviceRoleCalls.push("client")
      return createPgSupabaseClient(DB)
    }
  }
})

const { resolveDestination } = await import("./email/processor.ts")
const { buildCashRedemptionAdminReviewEmail } = await import("./email/cash-redemption-admin-template.ts")
const { listCashRedemptionsForStaff } = await import("./announcements/cash-redemption-admin-read.ts")

const CLAIMANT = "b1000000-0000-4000-8000-000000000001"

function seed(cents = 500) {
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
}

const adminCount = () =>
  Number(sql(DB, "select count(*) from public.email_deliveries where template='cash_redemption_admin_review'"))
const customerCount = () =>
  Number(sql(DB, "select count(*) from public.email_deliveries where template='cash_redemption_received'"))

// ===========================================================================
// Atomic, exactly-once notification
// ===========================================================================

test("a NEW request queues exactly one admin notification", () => {
  seed()
  sql(DB, `select public.request_cash_redemption('${CLAIMANT}')`)

  assert.equal(adminCount(), 1, "the operator was not notified of a new review")
  assert.equal(customerCount(), 1, "the customer notification regressed")
})

test("the notification is created ATOMICALLY with the request and the freeze", () => {
  seed()
  sql(DB, `select public.request_cash_redemption('${CLAIMANT}')`)

  // All four exist together, or the transaction would not have committed.
  assert.equal(Number(sql(DB, "select count(*) from public.cash_redemption_requests")), 1)
  assert.equal(Number(sql(DB, `select frozen_cents from public.store_credit_lots where user_id='${CLAIMANT}'`)), 500)
  assert.equal(customerCount(), 1)
  assert.equal(adminCount(), 1)
})

test("a RETRY does not duplicate the admin notification", () => {
  seed()
  for (let i = 0; i < 4; i++) {
    sql(DB, `select public.request_cash_redemption('${CLAIMANT}')`)
  }
  assert.equal(adminCount(), 1, "repeated requests spammed the operations mailbox")
  assert.equal(customerCount(), 1)
})

test("an ALREADY-OPEN request notifies nobody a second time", () => {
  seed()
  sql(DB, `select public.request_cash_redemption('${CLAIMANT}')`)
  const reason = sql(DB, `select reason from public.request_cash_redemption('${CLAIMANT}')`)

  assert.equal(reason, "already_open")
  assert.equal(adminCount(), 1)
  assert.equal(customerCount(), 1)
})

test("the idempotency key is deterministic on the request id", () => {
  seed()
  sql(DB, `select public.request_cash_redemption('${CLAIMANT}')`)
  const id = sql(DB, "select id from public.cash_redemption_requests")
  assert.equal(
    sql(DB, "select idempotency_key from public.email_deliveries where template='cash_redemption_admin_review'"),
    `cash_redemption_admin:${id}`
  )
})

// ===========================================================================
// Destination resolved at processing time
// ===========================================================================

test("the ADMIN destination comes from configuration, not the stored row", () => {
  seed()
  sql(DB, `select public.request_cash_redemption('${CLAIMANT}')`)

  // The row carries an empty recipient by design.
  assert.equal(
    sql(DB, "select recipient from public.email_deliveries where template='cash_redemption_admin_review'"),
    ""
  )

  const row = { template: "cash_redemption_admin_review", recipient: "" }
  assert.equal(
    resolveDestination(row, { CASH_REDEMPTION_ADMIN_EMAIL: "business@realfiction.live" }),
    "business@realfiction.live"
  )
})

test("an UNCONFIGURED admin mailbox resolves to null, never to a guess", () => {
  const row = { template: "cash_redemption_admin_review", recipient: "" }
  assert.equal(resolveDestination(row, {}), null)
  assert.equal(resolveDestination(row, { CASH_REDEMPTION_ADMIN_EMAIL: "   " }), null)
  // Notably it does NOT silently fall back to EMAIL_SUPPORT_ADDRESS: an
  // operations alert going somewhere nobody chose is worse than parking it.
  assert.equal(resolveDestination(row, { EMAIL_SUPPORT_ADDRESS: "support@realfiction.live" }), null)
})

test("an ORDINARY delivery still uses its stored recipient", () => {
  assert.equal(
    resolveDestination(
      { template: "cash_redemption_received", recipient: "claimant@e.test" },
      { CASH_REDEMPTION_ADMIN_EMAIL: "business@realfiction.live" }
    ),
    "claimant@e.test"
  )
})

// ===========================================================================
// No sensitive material in the notification
// ===========================================================================

test("the admin email carries NO gift-card secret or crypto material", () => {
  seed()
  sql(DB, `select public.request_cash_redemption('${CLAIMANT}')`)

  const params = sql(DB, "select params::text from public.email_deliveries where template='cash_redemption_admin_review'")
  const rendered = buildCashRedemptionAdminReviewEmail({
    requestId: "c2ff3609-7fa0-43d8-ba02-db46d078ffe0",
    claimantUserId: CLAIMANT,
    requestedCents: 500,
    frozenCents: 500,
    state: "requested",
    requestedAt: "2026-08-08T05:57:41Z",
    siteUrl: "https://realfiction.live"
  })
  const body = `${params} ${rendered.subject} ${rendered.text} ${rendered.html}`

  for (const forbidden of [
    /verifier/i,
    /ciphertext/i,
    /delivery_secret/i,
    // Precise: the account field is legitimately called `claimant_user_id`,
    // so a bare /claim/ matches a non-secret and proves nothing.
    /claim_secret/i,
    /claim_url/i,
    /claimUrl/,
    /gift-cards\/claim#/,
    /RFG-[A-Z0-9]/,
    /pepper/i,
    /encryption/i,
    /key_version/i,
    /payment_intent/i,
    /\bpi_/,
    /\bch_/,
    /sk_(test|live)/
  ]) {
    assert.ok(!forbidden.test(body), `the admin notification leaked ${forbidden}`)
  }
})

test("the admin email links to the queue and states the amount", () => {
  const email = buildCashRedemptionAdminReviewEmail({
    requestId: "c2ff3609-7fa0-43d8-ba02-db46d078ffe0",
    claimantUserId: CLAIMANT,
    requestedCents: 500,
    frozenCents: 500,
    state: "requested",
    requestedAt: "2026-08-08T05:57:41Z",
    siteUrl: "https://realfiction.live"
  })
  assert.match(email.text, /https:\/\/realfiction\.live\/admin\/cash-redemptions/)
  assert.match(email.subject, /\$5\.00/)
  // It says plainly that the page, not the email, is authoritative.
  assert.match(email.text, /whether or not this email arrives/i)
})

// ===========================================================================
// Authorization on the queue read
// ===========================================================================

test("SIGNED OUT cannot read the queue, and no service-role client is created", async () => {
  seed()
  sql(DB, `select public.request_cash_redemption('${CLAIMANT}')`)
  serviceRoleCalls.length = 0

  const { requireStaff } = await import("./auth/staff.ts")
  session.user = null
  session.isAdmin = false

  const staff = await requireStaff()
  assert.equal(staff.ok, false)
  // The page calls notFound() before ever reading. Nothing privileged runs.
  assert.deepEqual(serviceRoleCalls, [], "a signed-out request created a service-role client")
})

test("an ORDINARY user cannot read the queue", async () => {
  const { requireStaff } = await import("./auth/staff.ts")
  session.user = { id: "22222222-2222-4222-8222-222222222222", email: "player@example.com" }
  session.isAdmin = false
  serviceRoleCalls.length = 0

  const staff = await requireStaff()
  assert.equal(staff.ok, false)
  assert.equal(staff.ok === false && staff.reason, "not_staff")
  assert.deepEqual(serviceRoleCalls, [], "a non-staff request created a service-role client")
})

test("STAFF sees the queue, open requests first", async () => {
  seed()
  sql(DB, `select public.request_cash_redemption('${CLAIMANT}')`)
  session.user = { id: "11111111-1111-4111-8111-111111111111", email: "staff@realfiction.live" }
  session.isAdmin = true

  const rows = await listCashRedemptionsForStaff()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].isOpen, true)
  assert.equal(rows[0].requestedCents, 500)
  assert.equal(rows[0].frozenCents, 500)
  assert.equal(rows[0].state, "requested")
  // Delivery state is visible so a failed email cannot hide the request.
  assert.ok(["pending", "not_queued", "sent"].includes(rows[0].adminNotified))
})

test("a FAILED admin email does not remove the request from the queue", async () => {
  seed()
  sql(DB, `select public.request_cash_redemption('${CLAIMANT}')`)
  // `failed` is not a legal value; the column allows failed_permanent.
  sql(DB, "update public.email_deliveries set delivery_outcome='failed_permanent' where template='cash_redemption_admin_review'")

  session.user = { id: "11111111-1111-4111-8111-111111111111", email: "staff@realfiction.live" }
  session.isAdmin = true

  const rows = await listCashRedemptionsForStaff()
  assert.equal(rows.length, 1, "a mail failure hid the request from the operator")
  assert.equal(rows[0].adminNotified, "failed_permanent", "the failure is not surfaced")
  assert.equal(rows[0].isOpen, true)
})

// ===========================================================================
// No automatic payout
// ===========================================================================

test("NOTHING in the admin surface can move money", async () => {
  const fs = await import("node:fs")
  const page = fs.readFileSync(new URL("../app/admin/cash-redemptions/page.tsx", import.meta.url), "utf8")
  const read = fs.readFileSync(
    new URL("./announcements/cash-redemption-admin-read.ts", import.meta.url),
    "utf8"
  )

  // Read-only in this version: no mutation RPC, no form, no POST.
  for (const source of [page, read]) {
    assert.ok(!/resolve_cash_redemption\s*"/.test(source), "the page calls the mutation RPC")
    assert.ok(!/method:\s*"POST"/.test(source), "the page posts")
    assert.ok(!/<form/i.test(source), "the page has a form")
  }
  // And no payout mechanism exists anywhere in the admin surface.
  for (const forbidden of [/payout\(/, /stripe/i, /transfer/i, /createPayout/]) {
    assert.ok(!forbidden.test(page), `the page references ${forbidden}`)
  }
})
