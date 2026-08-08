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

export function normalizeSlug(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, LIMITS.slug)
}

export function validateAnnouncement(raw: Record<string, unknown>): ValidationResult {
  const slug = normalizeSlug(String(raw.slug ?? ""))
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
