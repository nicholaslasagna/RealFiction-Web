import "server-only"

// Staff-only reads for the admin list.
//
// Separate from lib/announcements/read.ts on purpose: that module serves public
// pages and must never return a draft. This one returns drafts, so it is only
// ever called after `requireStaff()` has passed.

import { getSupabaseServiceRoleClient } from "@/lib/supabase/service-role"

export type AdminAnnouncement = {
  id: string
  slug: string
  title: string
  excerpt: string
  body: string
  category: string
  status: string
  publishedAt: string | null
  authorDisplay: string | null
  imageUrl: string | null
  mirrorToDiscord: boolean
  discordState: string
  discordAttempts: number
  discordLastError: string | null
}

export async function listAnnouncementsForStaff(): Promise<AdminAnnouncement[]> {
  try {
    const supabase = getSupabaseServiceRoleClient()
    const { data, error } = await supabase
      .from("announcements")
      .select(
        "id,slug,title,excerpt,body,category,status,published_at,author_display,image_url,mirror_to_discord,discord_state,discord_attempts,discord_last_error"
      )
      .order("created_at", { ascending: false })
      .limit(100)

    if (error || !Array.isArray(data)) {
      return []
    }

    return data.map((row) => ({
      id: String(row.id),
      slug: String(row.slug),
      title: String(row.title ?? ""),
      excerpt: String(row.excerpt ?? ""),
      body: String(row.body ?? ""),
      category: String(row.category ?? "Announcement"),
      status: String(row.status ?? "draft"),
      publishedAt: (row.published_at as string | null) ?? null,
      authorDisplay: (row.author_display as string | null) ?? null,
      imageUrl: (row.image_url as string | null) ?? null,
      mirrorToDiscord: row.mirror_to_discord !== false,
      discordState: String(row.discord_state ?? "pending"),
      discordAttempts: Number(row.discord_attempts ?? 0),
      discordLastError: (row.discord_last_error as string | null) ?? null
    }))
  } catch {
    return []
  }
}
