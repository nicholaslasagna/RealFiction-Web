// The preflight reporter: the ONLY thing that formats preflight output.
//
// WHY THIS IS AN ALLOWLIST AND NOT A STRING
// =========================================
// `record` used to take a free-form `detail` string, and callers passed it
// values derived from the environment: a slice of STRIPE_SECRET_KEY, Stripe's
// own error text (which can echo a redacted key fragment), and Supabase error
// messages (which can carry the project URL). All of it reached console.log
// twice — once per check, and again in the BLOCKED summary.
//
// A reason CODE cannot carry a secret. Text is rendered only from the frozen
// table below, so a caller that passes an env-derived string gets nothing
// printed rather than a leak: the string is not a key here, so it does not
// resolve. That is a structural property, not a convention to remember.
//
// It lives in its own module so the guarantee is directly testable — see
// lib/preflight-reporter.test.ts, which drives it with real secret-shaped
// input and asserts none of it survives.

export const REASONS = Object.freeze({
  stripe_key_not_test: "key is not a test-mode key",
  stripe_unreachable: "Stripe did not accept the key or was unreachable",
  stripe_livemode_true: "Stripe reports this key is LIVE mode",
  migration_missing: "function missing - migration unapplied",
  catalog_unreadable: "gift-card catalog could not be read",
  row_count_wrong: "unexpected number of gift-card rows",
  denominations_wrong: "denominations do not match the approved ladder",
  rows_not_active: "not all nine rows are active",
  store_unreachable: "staging /store did not return a page",
  gate_closed: "still Coming Soon - a runtime secret is missing",
  gate_open: "purchase form rendered",
  ok: "ok"
})

/**
 * Renders one line. Returns the text AND the row to store, so both the
 * per-check output and the final summary are built from the same safe values.
 *
 * @param reasonCode key of REASONS, or null. Anything else renders nothing.
 * @param count      a NUMBER. Coerced, so it cannot smuggle a string through.
 */
export function formatResult(ok, label, reasonCode = null, count = null) {
  // An unknown code resolves to nothing. This is what makes a future
  // `record(false, "x", someEnvValue)` print no value at all.
  const reason =
    typeof reasonCode === "string" && Object.hasOwn(REASONS, reasonCode) ? REASONS[reasonCode] : null

  // Number() yields NaN for any non-numeric string, so a count cannot carry text.
  const numeric = count === null || count === undefined ? null : Number(count)
  const shown = Number.isFinite(numeric) ? String(numeric) : null

  const parts = [reason, shown].filter(Boolean)
  return {
    row: { ok, label, reason: reason ?? null, count: shown },
    line: `${ok ? "READY  " : "BLOCKED"}  ${label}${parts.length > 0 ? `  — ${parts.join(" ")}` : ""}`
  }
}

/** One blocked item, for the closing summary. Same safe fields, nothing else. */
export function formatBlocked(row) {
  const parts = [row.reason, row.count].filter(Boolean)
  return `  - ${row.label}${parts.length > 0 ? `  (${parts.join(" ")})` : ""}`
}
