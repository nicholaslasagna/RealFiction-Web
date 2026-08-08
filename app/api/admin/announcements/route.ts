// POST /api/admin/announcements — the staff publish/save endpoint.
//
// AUTHORIZATION IS RE-CHECKED HERE
// ================================
// The admin page also checks, but a page check protects a page. This endpoint
// is reachable directly with curl, so it does its own `requireStaff()` before
// reading the body — and the check asks the database about the caller's own
// session rather than reading anything the request supplied.
//
// The service-role client appears only AFTER that check passes, and only
// inside this module. It is never returned, never logged, and no field of the
// request can influence which Discord webhook the mirror later uses — the
// worker reads that from the environment.

import { requireStaff } from "@/lib/auth/staff"
import { validateAnnouncement } from "@/lib/announcements/validate"
import { safeJsonError } from "@/lib/security"
import { checkSameOrigin } from "@/lib/auth/same-origin"
import { getSupabaseServiceRoleClient } from "@/lib/supabase/service-role"

export const dynamic = "force-dynamic"

/** Fields a client must never be able to set. Rejected, not ignored. */
const FORBIDDEN = [
  "publishedAt",
  "published_at",
  "discordState",
  "discord_state",
  "discordMessageId",
  "discord_message_id",
  "webhookUrl",
  "webhook",
  "role",
  "isAdmin",
  "userId"
]

export async function POST(request: Request) {
  // Same-origin boundary for a browser-session mutation. SameSite=Lax
  // already blocks CSRF today, but that is a library default this
  // application does not control. See lib/auth/same-origin.ts.
  const sameOrigin = checkSameOrigin(request)
  if (!sameOrigin.ok) {
    console.warn("cross_origin_mutation_rejected", { route: "admin/announcements", reason: sameOrigin.reason })
    return safeJsonError("Something in your request does not look right.", 403)
  }

  const staff = await requireStaff()
  if (!staff.ok) {
    // Signed-out and not-staff get the SAME answer. A different response would
    // let anyone enumerate who has staff access.
    if (staff.reason === "unavailable") {
      return safeJsonError("We could not verify your access. Please try again.", 503)
    }
    return safeJsonError("Not found.", 404)
  }

  // ---- Retraction. A separate verb, not a variant of publish. -----------
  // Modelled as its own action so `publish: false` can never be mistaken for
  // "take it down": saving a draft and retracting a live announcement are
  // different intentions with different Discord consequences.
  let raw: Record<string, unknown>
  try {
    raw = ((await request.json()) ?? {}) as Record<string, unknown>
  } catch {
    return safeJsonError("Something in your request does not look right.", 400)
  }

  if (raw.action === "unpublish") {
    const slug = typeof raw.slug === "string" ? raw.slug.trim().toLowerCase() : ""
    if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      return safeJsonError("Something in your request does not look right.", 400)
    }

    try {
      const supabase = getSupabaseServiceRoleClient()
      const { data, error } = await supabase.rpc("unpublish_announcement", { p_slug: slug })

      if (error) {
        console.error("announcement_unpublish_failed", { code: error.code ?? "unknown" })
        return safeJsonError("We could not unpublish that. Please try again.", 503)
      }

      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null
      console.warn("announcement_unpublished", {
        slug,
        status: row?.status,
        discord: row?.discord_state,
        actor: staff.userId
      })

      return Response.json({
        slug,
        status: String(row?.status ?? "draft"),
        discordState: String(row?.discord_state ?? "skipped"),
        changed: row?.changed === true
      })
    } catch {
      console.error("announcement_unpublish_error")
      return safeJsonError("We could not unpublish that. Please try again.", 503)
    }
  }

  // ---- Manual recovery from a stuck Discord retraction ------------------
  // An explicit human assertion — "I looked at the channel and the message is
  // gone" — and the only way out of `retract_failed`. It publishes nothing and
  // contacts Discord not at all: if we could verify it automatically, the
  // DELETE would not have failed.
  if (raw.action === "confirm_discord_removed") {
    const slug = typeof raw.slug === "string" ? raw.slug.trim().toLowerCase() : ""
    if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      return safeJsonError("Something in your request does not look right.", 400)
    }

    try {
      const supabase = getSupabaseServiceRoleClient()
      const { data, error } = await supabase.rpc("confirm_announcement_discord_removed", {
        p_slug: slug
      })

      if (error) {
        console.error("announcement_confirm_removed_failed", { code: error.code ?? "unknown" })
        return safeJsonError("We could not record that. Please try again.", 503)
      }

      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null
      console.warn("announcement_discord_removal_confirmed", {
        slug,
        discord: row?.discord_state,
        changed: row?.changed,
        actor: staff.userId
      })

      return Response.json({
        slug,
        discordState: String(row?.discord_state ?? "unknown"),
        changed: row?.changed === true
      })
    } catch {
      console.error("announcement_confirm_removed_error")
      return safeJsonError("We could not record that. Please try again.", 503)
    }
  }

  const payload = raw

  for (const field of FORBIDDEN) {
    if (payload[field] !== undefined) {
      return safeJsonError("Something in your request does not look right.", 400)
    }
  }

  const validated = validateAnnouncement(payload)
  if (!validated.ok) {
    return Response.json({ error: validated.message, field: validated.field }, { status: 400 })
  }

  const input = validated.value

  try {
    const supabase = getSupabaseServiceRoleClient()
    const { data, error } = await supabase.rpc("publish_announcement", {
      p_slug: input.slug,
      p_title: input.title,
      p_excerpt: input.excerpt,
      p_body: input.body,
      p_category: input.category,
      p_author_display: input.authorDisplay,
      p_image_url: input.imageUrl,
      p_mirror_to_discord: input.mirrorToDiscord,
      // The ONLY thing that makes an announcement public, and it is an explicit
      // boolean the form has to send. A draft cannot become public by omission.
      p_publish: input.publish
    })

    if (error) {
      console.error("announcement_publish_failed", { code: error.code ?? "unknown" })
      return safeJsonError("We could not save that. Please try again.", 503)
    }

    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null
    console.info("announcement_saved", {
      slug: input.slug,
      status: row?.status,
      actor: staff.userId
    })

    return Response.json({
      slug: String(row?.slug ?? input.slug),
      status: String(row?.status ?? "draft"),
      discordState: String(row?.discord_state ?? "pending"),
      changed: row?.changed === true
    })
  } catch {
    console.error("announcement_publish_error")
    return safeJsonError("We could not save that. Please try again.", 503)
  }
}

/** A GET must never mutate. */
export async function GET() {
  return safeJsonError("Method not allowed.", 405)
}
