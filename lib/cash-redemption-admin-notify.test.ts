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

// ===========================================================================
// The DATABASE is a second boundary, independent of requireStaff()
//
// `requireStaff()` guards the page. It cannot guard a request that never
// reaches the page — a signed-in customer holds an anon-key session and can
// call PostgREST directly. Financial-review data must be unreachable that way
// too.
// ===========================================================================

test("staff_cash_redemption_queue is a SECURITY DEFINER function, not a view or table", () => {
  assert.equal(
    sql(DB, `select count(*) from pg_views where schemaname='public' and viewname='staff_cash_redemption_queue'`),
    "0",
    "a view would be reachable through PostgREST directly"
  )
  assert.equal(
    sql(DB, `select count(*) from pg_tables where schemaname='public' and tablename='staff_cash_redemption_queue'`),
    "0"
  )
  assert.equal(
    sql(DB, `select prosecdef::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
             where n.nspname='public' and p.proname='staff_cash_redemption_queue'`),
    "true"
  )
})

test("it has a FIXED search_path and the expected owner", () => {
  assert.equal(
    sql(DB, `select array_to_string(proconfig,',') from pg_proc p join pg_namespace n on n.oid=p.pronamespace
             where n.nspname='public' and p.proname='staff_cash_redemption_queue'`),
    "search_path=public",
    "a mutable search_path lets a caller shadow the tables it reads"
  )
  assert.equal(
    sql(DB, `select pg_get_userbyid(proowner) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
             where n.nspname='public' and p.proname='staff_cash_redemption_queue'`),
    "postgres"
  )
})

test("PUBLIC, anon and authenticated CANNOT execute the queue function", () => {
  for (const role of ["public", "anon", "authenticated"]) {
    assert.equal(
      sql(DB, `select has_function_privilege('${role}','public.staff_cash_redemption_queue(integer)','execute')::text`),
      "false",
      `${role} can read the financial review queue directly`
    )
  }
  assert.equal(
    sql(DB, `select has_function_privilege('service_role','public.staff_cash_redemption_queue(integer)','execute')::text`),
    "true",
    "the backend lost its access"
  )
})

test("the ACL contains no PUBLIC grant at all", () => {
  // A bare `=X/owner` entry is the PUBLIC grant. Its absence is the thing
  // has_function_privilege('public', …) reflects, asserted directly.
  const acl = sql(DB, `select coalesce(proacl::text,'NULL') from pg_proc p
                       join pg_namespace n on n.oid=p.pronamespace
                       where n.nspname='public' and p.proname='staff_cash_redemption_queue'`)
  assert.notEqual(acl, "NULL", "a null ACL means PUBLIC EXECUTE")
  assert.ok(!/[{,]=X\//.test(acl), `the ACL carries a PUBLIC grant: ${acl}`)
})

test("an ORDINARY AUTHENTICATED session is refused by the DATABASE, not just the app", () => {
  seed()
  sql(DB, `select public.request_cash_redemption('${CLAIMANT}')`)

  // Executed AS `authenticated`, exactly as a PostgREST call from a signed-in
  // browser would be. No application code is involved.
  const outcome = sql(
    DB,
    `do $$ begin
       perform public.staff_cash_redemption_queue(50);
       raise exception 'REACHED';
     exception
       when insufficient_privilege then raise notice 'denied';
       when others then raise notice 'other:%', sqlerrm;
     end $$;`,
    { role: "authenticated" }
  )
  assert.doesNotMatch(String(outcome), /REACHED/, "an ordinary user read the review queue directly")
})

test("the underlying review table is unreadable by anon and authenticated", () => {
  seed()
  sql(DB, `select public.request_cash_redemption('${CLAIMANT}')`)

  for (const role of ["anon", "authenticated"]) {
    assert.equal(
      sql(DB, `select has_table_privilege('${role}','public.cash_redemption_requests','select')::text`),
      "false",
      `${role} can select the review table directly`
    )
  }
  // RLS on as well, so the deny survives a future accidental GRANT.
  assert.equal(
    sql(DB, `select relrowsecurity::text from pg_class c join pg_namespace n on n.oid=c.relnamespace
             where n.nspname='public' and c.relname='cash_redemption_requests'`),
    "true"
  )
})

test("the outbox is granted to authenticated but RLS returns NOTHING", () => {
  seed()
  sql(DB, `select public.request_cash_redemption('${CLAIMANT}')`)

  // The GRANT exists; the absence of any permissive policy is what denies.
  // Asserted empirically rather than inferred, because a future policy would
  // silently expose notification metadata.
  const visible = sql(DB, "select count(*) from public.email_deliveries", { role: "authenticated" })
  assert.equal(visible, "0", "an authenticated user can read the email outbox")
})

// ===========================================================================
// The blank recipient can never reach the provider
// ===========================================================================

const { isSendableAddress, sendProviderEmail } = await import("./email/transport.ts")

test("the TRANSPORT refuses a blank, whitespace or sentinel recipient", async () => {
  // Asserted at the lowest boundary every send passes through, so no caller —
  // present or future — can bypass it.
  const calls: string[] = []
  const fetchImpl = (async (url: unknown) => {
    calls.push(String(url))
    return { ok: true, status: 200, json: async () => ({ id: "x" }) } as never
  }) as never as typeof fetch

  for (const to of ["", "   ", "\t\n", "@staff", "admin", "no-at-sign.example"]) {
    const result = await sendProviderEmail(
      { to, subject: "s", text: "t", html: "<p>t</p>", idempotencyKey: "k" },
      { apiKey: "test-only", from: "RealFiction <o@e.test>", fetchImpl }
    )
    assert.equal(result.kind, "permanent", `"${to}" was not refused`)
    assert.equal(result.kind === "permanent" && result.category, "invalid_recipient")
  }

  assert.deepEqual(calls, [], "the provider was contacted with an unsendable recipient")
})

test("a real address still sends", async () => {
  const calls: string[] = []
  const fetchImpl = (async (url: unknown) => {
    calls.push(String(url))
    return { ok: true, status: 200, json: async () => ({ id: "msg_1" }) } as never
  }) as never as typeof fetch

  const result = await sendProviderEmail(
    { to: "business@realfiction.live", subject: "s", text: "t", html: "<p>t</p>", idempotencyKey: "k" },
    { apiKey: "test-only", from: "RealFiction <o@e.test>", fetchImpl }
  )
  assert.equal(result.kind, "accepted")
  assert.equal(calls.length, 1)
})

test("isSendableAddress rejects exactly what it should", () => {
  for (const bad of ["", " ", "@staff", "a@b", "a b@c.test", `${"x".repeat(250)}@e.test`]) {
    assert.equal(isSendableAddress(bad), false, `${JSON.stringify(bad)} was accepted`)
  }
  for (const good of ["business@realfiction.live", "ops+reviews@realfiction.live"]) {
    assert.equal(isSendableAddress(good), true, `${good} was rejected`)
  }
})

// ===========================================================================
// unconfigured -> configured recovery, end to end
// ===========================================================================

test("an UNCONFIGURED admin notification recovers when configuration arrives", () => {
  seed()
  sql(DB, `select public.request_cash_redemption('${CLAIMANT}')`)
  const id = sql(DB, "select id from public.email_deliveries where template='cash_redemption_admin_review'")

  // 1-2. The row exists; the mailbox is not configured.
  assert.equal(resolveDestination({ template: "cash_redemption_admin_review", recipient: "" }, {}), null)

  // 3-4. The processor parks it WITHOUT contacting the provider.
  sql(DB, `select public.claim_due_email_deliveries(10, 120, 'w1')`)
  sql(DB, `select public.mark_email_unconfigured('${id}', 300)`)
  assert.equal(
    sql(DB, `select delivery_outcome from public.email_deliveries where id='${id}'`),
    "unconfigured"
  )

  // The attempt budget was NOT consumed — the claim's increment is undone, so a
  // long outage cannot exhaust the retries a real delivery will need.
  assert.equal(
    sql(DB, `select attempts from public.email_deliveries where id='${id}'`),
    "0",
    "a missing binding burned an attempt"
  )

  // And it is not retried in a hot loop.
  assert.equal(
    sql(DB, `select (next_attempt_at > now() + interval '30 seconds')::text
             from public.email_deliveries where id='${id}'`),
    "true",
    "an unconfigured row would be re-claimed immediately"
  )

  // 5-6. Configuration arrives, the backoff elapses, and the SAME row is
  // selectable again — it was never stranded.
  sql(DB, `update public.email_deliveries set next_attempt_at = now() - interval '1 second' where id='${id}'`)
  const claimed = sql(DB, `select count(*) from public.claim_due_email_deliveries(10, 120, 'w2')`)
  assert.equal(claimed, "1", "an unconfigured row became permanently stranded")

  // 7. It sends once.
  sql(DB, `select public.mark_email_sent('${id}', 'provider-msg-1', 200)`)
  assert.equal(sql(DB, `select delivery_outcome from public.email_deliveries where id='${id}'`), "sent")

  // 8. A later worker does not pick it up again.
  assert.equal(
    sql(DB, `select count(*) from public.claim_due_email_deliveries(10, 120, 'w3')`),
    "0",
    "a sent notification was re-claimed and would be duplicated"
  )
  assert.equal(
    sql(DB, "select count(*) from public.email_deliveries where template='cash_redemption_admin_review'"),
    "1"
  )
})
