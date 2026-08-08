import "server-only"

// Reading canonical announcements for the website.
//
// `/discord` and `/updates` both read from HERE, so they cannot disagree about
// what the latest announcement is. Nothing reads Discord: Discord is a delivery
// destination, not a database.

import { getSupabaseServiceRoleClient } from "@/lib/supabase/service-role"

export type LatestAnnouncement = {
  slug: string
  title: string
  excerpt: string
  category: string
  publishedAt: string | null
  authorDisplay: string | null
  imageUrl: string | null
  /** Whether Discord already holds this one. Presentation only. */
  mirrored: boolean
}

/**
 * The newest PUBLISHED announcement, or null.
 *
 * Drafts and future-dated rows are excluded in SQL, not here — a filter in the
 * application is one refactor away from being dropped, and a leaked draft is a
 * public mistake.
 *
 * Never throws: an announcement is not why somebody opened the page.
 */
export async function getLatestAnnouncement(): Promise<LatestAnnouncement | null> {
  try {
    const supabase = getSupabaseServiceRoleClient()
    const { data, error } = await supabase.rpc("latest_announcement")
    if (error) {
      return null
    }
    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null
    if (!row || typeof row.slug !== "string") {
      return null
    }
    return {
      slug: row.slug,
      title: String(row.title ?? ""),
      excerpt: String(row.excerpt ?? ""),
      category: String(row.category ?? "Announcement"),
      publishedAt: (row.published_at as string | null) ?? null,
      authorDisplay: (row.author_display as string | null) ?? null,
      imageUrl: (row.image_url as string | null) ?? null,
      mirrored: row.mirrored === true
    }
  } catch {
    return null
  }
}

export type AnnouncementDetail = {
  slug: string
  title: string
  excerpt: string
  body: string
  category: string
  publishedAt: string | null
  authorDisplay: string | null
  imageUrl: string | null
}

/**
 * One PUBLISHED announcement by slug, or null.
 *
 * Drafts and future-dated rows are excluded by `published_announcements` in
 * SQL. Filtering here instead would put the rule one refactor away from being
 * dropped, and a leaked draft is a public mistake — so the database decides.
 */
export async function getAnnouncementBySlug(slug: string): Promise<AnnouncementDetail | null> {
  if (!slug || !/^[a-z0-9][a-z0-9-]{0,80}$/i.test(slug)) {
    return null
  }

  try {
    const supabase = getSupabaseServiceRoleClient()
    const { data, error } = await supabase.rpc("published_announcements", { p_limit: 200 })
    if (error || !Array.isArray(data)) {
      return null
    }
    const row = (data as Record<string, unknown>[]).find((entry) => entry.slug === slug)
    if (!row) {
      return null
    }
    return {
      slug: String(row.slug),
      title: String(row.title ?? ""),
      excerpt: String(row.excerpt ?? ""),
      body: String(row.body ?? ""),
      category: String(row.category ?? "Announcement"),
      publishedAt: (row.published_at as string | null) ?? null,
      authorDisplay: (row.author_display as string | null) ?? null,
      imageUrl: (row.image_url as string | null) ?? null
    }
  } catch {
    return null
  }
}
