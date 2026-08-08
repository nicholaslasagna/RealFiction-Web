import "server-only"

// The /updates archive: canonical announcements first, static history after.
//
// `lib/data.ts` holds the existing updates as a hardcoded array. Those are real
// history and are NOT migrated — rewriting them into the database would risk
// losing the rich `sections` structure the detail pages render, for no benefit.
//
// So the feed is a merge: rows published through `publish_announcement` sit
// alongside the static archive, ordered by date. Slugs are unique across both
// because a database row whose slug collides with a static entry would make
// /updates/<slug> ambiguous — the DB row wins, and the collision is logged.

import { updates, type UpdateEntry } from "@/lib/data"
import { getSupabaseServiceRoleClient } from "@/lib/supabase/service-role"

export type FeedEntry = {
  slug: string
  title: string
  summary: string
  date: string
  type: string
  version: string
  tags: string[]
  /** True for rows staff published through the announcement system. */
  canonical: boolean
}

const fromStatic = (entry: UpdateEntry): FeedEntry => ({
  slug: entry.slug,
  title: entry.title,
  summary: entry.summary,
  date: entry.date,
  type: entry.type,
  version: entry.version,
  tags: entry.tags,
  canonical: false
})

export async function getUpdatesFeed(): Promise<FeedEntry[]> {
  let published: FeedEntry[] = []

  try {
    const supabase = getSupabaseServiceRoleClient()
    const { data, error } = await supabase.rpc("published_announcements", { p_limit: 50 })
    if (!error && Array.isArray(data)) {
      published = data.map((row: Record<string, unknown>) => ({
        slug: String(row.slug),
        title: String(row.title ?? ""),
        summary: String(row.excerpt ?? ""),
        date: String(row.published_at ?? "").slice(0, 10),
        type: String(row.category ?? "Announcement"),
        version: "",
        tags: [],
        canonical: true
      }))
    }
  } catch {
    // The static archive still renders. An unreachable database must not empty
    // the updates page.
  }

  const seen = new Set(published.map((entry) => entry.slug))
  const merged = [...published, ...updates.filter((entry) => !seen.has(entry.slug)).map(fromStatic)]

  return merged.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}
