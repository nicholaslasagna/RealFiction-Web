// Same-origin enforcement for browser-session mutations.
//
// WHY, GIVEN SameSite=Lax ALREADY BLOCKS CSRF
// ===========================================
// It does, today. `@supabase/ssr` sets `sameSite: "lax"`, which stops
// cross-site form POSTs and cross-site framed requests from carrying the
// session cookie. That is a real control and this does not replace it.
//
// But it is a LIBRARY DEFAULT, not something this application asserts. A
// Supabase upgrade that changed it, a future cookie set with `SameSite=None`
// for an embed, or a browser that relaxes Lax for some case, would silently
// remove the only thing standing between a cross-site page and a financial
// mutation. Defence that lives entirely in someone else's default is defence
// you cannot audit.
//
// So: an explicit, exact-match Origin boundary, in one place.
//
// WHAT THIS IS NOT FOR
// ====================
// Server-to-server callers, which authenticate by signature or shared secret
// and legitimately send no Origin: the Stripe webhook, /api/plugin/**, the vote
// webhook, and the scheduled worker. Applying this to them would break real
// integrations while adding nothing — they are not browser-session routes and
// no browser can forge their credentials.

/** Methods that can change state. GET/HEAD/OPTIONS are not gated. */
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"])

/**
 * Origins allowed to drive a session mutation.
 *
 * EXACT string comparison against a parsed origin — never a regex, never a
 * suffix test. `endsWith(".realfiction.live")` matches
 * `evil-realfiction.live`, and a regex with an unescaped dot matches
 * `realfictionXlive`. Both are how this check is usually defeated.
 */
export function allowedOrigins(env: Record<string, string | undefined> = process.env): string[] {
  const configured = env.NEXT_PUBLIC_SITE_URL?.trim()
  const origins = new Set<string>()

  if (configured) {
    try {
      origins.add(new URL(configured).origin)
    } catch {
      // A malformed site URL must not silently widen the boundary.
    }
  }

  // Local development. Never added when a production site URL is configured,
  // so a deployed instance cannot be driven from a developer's machine.
  if (!configured || configured.includes("localhost") || env.NODE_ENV !== "production") {
    for (const port of ["3000", "3311", "3312", "3313"]) {
      origins.add(`http://localhost:${port}`)
      origins.add(`http://127.0.0.1:${port}`)
    }
  }

  return [...origins]
}

export type OriginCheck = { ok: true } | { ok: false; reason: "cross_origin" }

/**
 * Whether a browser-session mutation may proceed.
 *
 * PRESENT-AND-WRONG is refused. That is the rule that carries the security
 * value, and it is absolute.
 *
 * MISSING IS ALLOWED — and this was a deliberate reversal.
 * ========================================================
 * The first version of this refused a missing Origin on the reasoning that
 * browsers always send one, so its absence is not a real browser. That is true
 * but it does not follow that refusing helps, and it costs real callers:
 *
 *   * There is no browser mechanism that produces a CREDENTIALED CROSS-SITE
 *     mutation without an Origin header. Forms, fetch, and XHR all set it on
 *     cross-origin requests, and none can be made to omit it. So the attack
 *     this would supposedly block does not exist.
 *   * A non-browser caller (curl, a script) can omit Origin freely — but it has
 *     no session cookie, and every one of these routes independently requires
 *     an authenticated session. Without the cookie the request is already 401.
 *
 * So refusing a missing Origin blocks no attacker and breaks legitimate
 * non-browser clients. The session cookie remains mandatory either way; this
 * check is strictly additional to it, never a substitute.
 *
 * `Host` is deliberately not consulted. It is attacker-controlled in ways
 * `Origin` is not, and trusting it reintroduces the problem.
 */
export function checkSameOrigin(
  request: Request,
  env: Record<string, string | undefined> = process.env
): OriginCheck {
  if (!MUTATING.has(request.method.toUpperCase())) {
    return { ok: true }
  }

  const origin = request.headers.get("origin")
  if (!origin) {
    // See the contract above: no browser can produce a credentialed cross-site
    // mutation without this header, and the session cookie is still required.
    return { ok: true }
  }

  let parsed: string
  try {
    // Parsing normalises case and default ports, and rejects anything that is
    // not a real origin — including the literal "null" that a sandboxed frame
    // sends, which `new URL()` throws on.
    parsed = new URL(origin).origin
  } catch {
    return { ok: false, reason: "cross_origin" }
  }

  return allowedOrigins(env).includes(parsed) ? { ok: true } : { ok: false, reason: "cross_origin" }
}
