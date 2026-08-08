// Server-side validation for announcement mutations.
//
// Pure, so the rules are testable without a session or a database. Every field
// a client can send is bounded here; nothing reaches `publish_announcement`
// unchecked.
//
// Note what is NOT accepted from a client: publication timestamp, Discord
// delivery state, message id, author authority, or any webhook destination.
// Those are server or database concerns, and accepting them would let a caller
// backdate an announcement or redirect a mirror.

export type AnnouncementInput = {
  slug: string
  title: string
  excerpt: string
  body: string
  category: string
  authorDisplay: string | null
  imageUrl: string | null
  mirrorToDiscord: boolean
  publish: boolean
}

export type ValidationResult =
  | { ok: true; value: AnnouncementInput }
  | { ok: false; field: string; message: string }

/** Categories staff may choose. An allowlist, not free text. */
export const CATEGORIES = ["Announcement", "Update", "Event", "Maintenance", "Store"] as const

const LIMITS = { slug: 80, title: 140, excerpt: 400, body: 20_000, author: 60, image: 300 }

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * A DEFENSIVE SCAN BOUND, not a semantic limit.
 *
 * Two things call `normalizeSlug`: the admin form, which derives a slug from
 * the TITLE (up to `LIMITS.title`), and `validateAnnouncement` with a
 * client-supplied slug. The second rejects anything over `LIMITS.slug` before
 * normalising, so truncation is unreachable from the request path; this bound
 * exists for the TITLE path, which legitimately exceeds `LIMITS.slug` and is
 * meant to be normalised down.
 *
 * It exists only so an unbounded string can never be scanned. `LIMITS.title`
 * rather than a new number because that is the largest input any legitimate
 * caller produces.
 */
const MAX_SLUG_INPUT = LIMITS.title

/**
 * Slug normalisation, in ONE PASS.
 *
 * The previous implementation chained `.replace(/[^a-z0-9]+/g, "-")` with
 * `.replace(/^-+|-+$/g, "")`. The second is polynomial: against an input of
 * many hyphens the engine retries `-+$` from every position, so `"-".repeat(n)`
 * costs O(n²) — reachable from an unauthenticated request body, since
 * normalisation runs BEFORE the length check that would have rejected it.
 *
 * This scans each character exactly once and emits at most one character per
 * step, with no regex and therefore no backtracking.
 *
 * SEPARATORS ARE EMITTED LAZILY. A run of non-alphanumerics only sets a flag;
 * the `-` is written when the NEXT alphanumeric arrives. That single decision
 * gives three properties for free:
 *
 *   * runs collapse — many pending separators still write one `-`;
 *   * no leading `-` — the flag is ignored while the output is empty;
 *   * no trailing `-` — a pending separator with nothing after it is dropped,
 *     including when the loop stops early for length.
 *
 * Semantics are otherwise unchanged: `.toLowerCase()` still runs first, so
 * Unicode case folding behaves exactly as before.
 */
export function normalizeSlug(raw: string): string {
  const input = String(raw ?? "")
  // Bound BEFORE any work. O(n) is not the same as free.
  const source = (input.length > MAX_SLUG_INPUT ? input.slice(0, MAX_SLUG_INPUT) : input).toLowerCase()

  let out = ""
  let pendingSeparator = false

  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index)
    const isAlphanumeric = (code >= 97 && code <= 122) || (code >= 48 && code <= 57)

    if (!isAlphanumeric) {
      // Only meaningful once something has been emitted; a leading run is
      // dropped rather than becoming a leading hyphen.
      if (out.length > 0) {
        pendingSeparator = true
      }
      continue
    }

    if (pendingSeparator) {
      // Both the separator and the character must fit, or neither is written —
      // stopping after the `-` is exactly how truncation used to leave a
      // trailing hyphen.
      if (out.length + 2 > LIMITS.slug) {
        break
      }
      out += "-"
      pendingSeparator = false
    } else if (out.length + 1 > LIMITS.slug) {
      break
    }

    out += source[index]
  }

  return out
}

export function validateAnnouncement(raw: Record<string, unknown>): ValidationResult {
  const rawSlug = String(raw.slug ?? "")

  // Rejected BEFORE normalisation, and rejected rather than truncated.
  //
  // The bound is `LIMITS.slug`, NOT the scan bound. An explicit slug is its own
  // field with its own maximum — the same one the form enforces with
  // `maxLength={80}` — and it is independent of any title. Measuring it against
  // the title-derived scan bound let a 100-character slug normalise quietly down
  // to 80 and be accepted, so the caller got a slug they never asked for.
  //
  // `.length` counts UTF-16 code units, which is exactly what the HTML
  // `maxLength` attribute counts. Same field, same number, no separate counting
  // rule introduced here.
  if (rawSlug.length > LIMITS.slug) {
    return { ok: false, field: "slug", message: "That slug is too long." }
  }

  const slug = normalizeSlug(rawSlug)
  if (!slug || !SLUG_PATTERN.test(slug)) {
    return { ok: false, field: "slug", message: "Use lowercase letters, numbers, and hyphens." }
  }

  const title = String(raw.title ?? "").trim()
  if (!title) {
    return { ok: false, field: "title", message: "A title is required." }
  }
  if (title.length > LIMITS.title) {
    return { ok: false, field: "title", message: `Keep the title under ${LIMITS.title} characters.` }
  }

  const excerpt = String(raw.excerpt ?? "").trim()
  if (excerpt.length > LIMITS.excerpt) {
    return { ok: false, field: "excerpt", message: `Keep the excerpt under ${LIMITS.excerpt} characters.` }
  }

  const body = String(raw.body ?? "")
  if (body.length > LIMITS.body) {
    return { ok: false, field: "body", message: "That body is too long." }
  }

  const category = String(raw.category ?? "Announcement")
  if (!(CATEGORIES as readonly string[]).includes(category)) {
    return { ok: false, field: "category", message: "Choose one of the listed categories." }
  }

  const authorRaw = String(raw.authorDisplay ?? "").trim()
  if (authorRaw.length > LIMITS.author) {
    return { ok: false, field: "authorDisplay", message: "That attribution is too long." }
  }

  // Site-relative images only. An absolute URL would let an announcement embed
  // a remote asset — a tracking pixel on a public page, and an open proxy.
  const imageRaw = String(raw.imageUrl ?? "").trim()
  let imageUrl: string | null = null
  if (imageRaw) {
    if (!imageRaw.startsWith("/") || imageRaw.startsWith("//") || imageRaw.length > LIMITS.image) {
      return { ok: false, field: "imageUrl", message: "Use a site path such as /images/updates/x.png" }
    }
    imageUrl = imageRaw
  }

  return {
    ok: true,
    value: {
      slug,
      title,
      excerpt,
      body,
      category,
      authorDisplay: authorRaw || null,
      imageUrl,
      // Coerced, never trusted as-is: a missing field must not mean "publish".
      mirrorToDiscord: raw.mirrorToDiscord !== false,
      publish: raw.publish === true
    }
  }
}
