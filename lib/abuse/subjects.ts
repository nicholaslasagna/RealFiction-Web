// Pseudonymous subjects for abuse counting.
//
// WHAT THIS DELIBERATELY IS NOT
// =============================
// There is no device fingerprint here. No canvas, no font enumeration, no
// screen metrics, no user-agent parsing, no cookie beyond the session the site
// already sets, and nothing at all read from the client for this purpose. The
// only signals are things the customer already gave us — their account, their
// verified email — plus the network address the request arrived from.
//
// WHY A PEPPER RATHER THAN A PLAIN HASH
// =====================================
// An IPv4 space is 2^32. A plain SHA-256 of an address is reversible in
// seconds with a laptop, so an unpeppered "hash" of an IP is the IP. The pepper
// is a server-held secret that never reaches the database, which means the
// abuse table on its own — leaked, subpoenaed, or restored from a backup —
// yields no addresses and no email addresses.
//
// The pepper is never rotated casually: rotating it resets every counter, which
// is a deliberate operational act, not a maintenance chore.

/** Only these become subjects. Anything else would be a new data category. */
export type SubjectKind = "email" | "ip" | "recipient"

/**
 * The client address, but ONLY where it is trustworthy.
 *
 * `CF-Connecting-IP` is written by Cloudflare at the edge and overwrites
 * whatever the client sent, so behind our proxy it is authoritative.
 * `X-Forwarded-For` is not: any client can set it, and treating it as identity
 * would let an attacker spread their traffic across unlimited fake addresses —
 * or worse, attribute their abuse to somebody else's address and get a stranger
 * blocked. So it is ignored entirely rather than used as a fallback.
 *
 * Returns null when there is no trustworthy address, and the caller then counts
 * on the identities it does trust.
 */
export function trustworthyClientIp(headers: Headers): string | null {
  const cloudflare = headers.get("cf-connecting-ip")?.trim()
  if (!cloudflare) {
    return null
  }
  // A single address, nothing list-shaped. A comma here means something between
  // us and Cloudflare rewrote the header, which is exactly when not to trust it.
  if (cloudflare.includes(",") || cloudflare.length > 45) {
    return null
  }
  return cloudflare
}

/**
 * A stable, non-reversible subject id.
 *
 * Domain-separated by kind so the same string used as an email and as a
 * recipient produces different subjects; without that, a purchaser sending a
 * card to their own address would collide with themselves across two rules.
 */
export async function hashSubject(
  kind: SubjectKind,
  value: string | null | undefined,
  pepper: string | undefined
): Promise<string | null> {
  const normalized = (value ?? "").trim().toLowerCase()
  if (!normalized || !pepper) {
    // No pepper configured means no pseudonymous counting. Counting by account
    // still works, so the controls degrade rather than fail — and we never fall
    // back to storing the raw value.
    return null
  }

  const bytes = new TextEncoder().encode(`realfiction:abuse:${kind}:${pepper}:${normalized}`)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}
