// Delivering announcements to Discord.
//
// Runs on the EXISTING five-minute Cron Trigger, as a fifth isolated job. It is
// deliberately the last thing in the pipeline: a website announcement is
// already published and visible before this ever runs, so a Discord outage
// delays a mirror and nothing else.
//
// POST ONCE, PATCH ON EDIT, NEVER RE-POST
// =======================================
// `discord_message_id` is written exactly once, by the first successful POST
// (`?wait=true` is what makes Discord return the message id at all). Every
// later attempt for that row is a PATCH of that message. If the PATCH fails,
// the row goes to `review_required` — it never falls back to POSTing again,
// because a duplicate announcement in a public channel is worse than a stale
// one and cannot be un-sent.
//
// The webhook URL is read from the environment on the server and never
// returned, logged, or included in any result.

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import { buildAnnouncementPayload, type AnnouncementForDiscord } from "./discord-payload"

export type MirrorEnv = {
  SUPABASE_URL?: string
  NEXT_PUBLIC_SUPABASE_URL?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
  /** Runtime SECRET. Distinct from DISCORD_CONTACT_WEBHOOK_URL. */
  DISCORD_ANNOUNCEMENTS_WEBHOOK_URL?: string
  NEXT_PUBLIC_SITE_URL?: string
}

export type MirrorResult = {
  claimed: number
  delivered: number
  /** Discord messages removed for a retracted announcement. */
  retracted: number
  edited: number
  retried: number
  stopped: number
  skipped: number
}

const TIMEOUT_MS = 8_000

type ClaimRow = {
  id: string
  slug: string
  title: string
  excerpt: string
  category: string
  published_at: string | null
  author_display: string | null
  image_url: string | null
  discord_message_id: string | null
  /** 'mirror' (POST/PATCH) or 'retract' (DELETE), decided under the claim lock. */
  operation?: string | null
  attempts: number
}

function supabaseFor(env: MirrorEnv): SupabaseClient | null {
  const url = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? ""
  const key = env.SUPABASE_SERVICE_ROLE_KEY ?? ""
  return url && key
    ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
    : null
}

/** Hash of the mirrored fields. Must match publish_announcement's ordering. */
export async function contentHash(row: AnnouncementForDiscord): Promise<string> {
  const unit = String.fromCharCode(31)
  const material = [row.title, row.excerpt, row.category, row.imageUrl ?? ""].join(unit)
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

type DeliveryOutcome =
  | { kind: "delivered"; messageId: string | null }
  | { kind: "retry"; error: string }
  | { kind: "review"; error: string }

/**
 * One POST or PATCH.
 *
 * A 4xx that is not a rate limit is permanent — a malformed embed or a deleted
 * message will not fix itself — so it stops rather than burning six attempts.
 */
type RetractOutcome =
  | { kind: "deleted" }
  | { kind: "retry"; error: string }
  | { kind: "failed"; error: string }

/**
 * Deletes one previously mirrored message.
 *
 * A 404 is SUCCESS. The message is gone, which is the outcome we wanted —
 * treating it as a failure would strand the row in `retract_failed` and force a
 * human to confirm something Discord already told us.
 *
 * This never posts. There is no code path here that creates a message, because
 * a retraction that accidentally produced a replacement announcement would be
 * the worst possible outcome of asking to take one down.
 */
async function retract(
  webhookUrl: string,
  messageId: string,
  fetchImpl: typeof fetch
): Promise<RetractOutcome> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const response = await fetchImpl(
      `${webhookUrl}/messages/${encodeURIComponent(messageId)}`,
      { method: "DELETE", signal: controller.signal }
    )

    // 204 is the documented success; 404 means someone already removed it.
    if (response.ok || response.status === 404) {
      return { kind: "deleted" }
    }

    if (response.status === 429 || response.status >= 500) {
      return { kind: "retry", error: `provider_${response.status}` }
    }

    // 401/403: the webhook cannot touch that message. A human decides, and the
    // message id is kept so a later publish PATCHes rather than duplicating.
    return { kind: "failed", error: `provider_${response.status}` }
  } catch {
    // Unknown. Retry — a DELETE is idempotent, so a retry is safe even if the
    // first one actually landed.
    return { kind: "retry", error: "unreachable" }
  } finally {
    clearTimeout(timer)
  }
}

async function deliver(
  webhookUrl: string,
  payload: Record<string, unknown>,
  messageId: string | null,
  fetchImpl: typeof fetch
): Promise<DeliveryOutcome> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const editing = Boolean(messageId)
    // `wait=true` on create so Discord returns the message, which is the only
    // way to learn the id we need for future edits.
    const url = editing
      ? `${webhookUrl}/messages/${encodeURIComponent(messageId as string)}`
      : `${webhookUrl}?wait=true`

    const response = await fetchImpl(url, {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    })

    if (response.ok) {
      if (editing) {
        return { kind: "delivered", messageId }
      }
      const created = (await response.json().catch(() => null)) as { id?: string } | null
      // A create that succeeded but whose id we could not read is the one case
      // that must NOT be retried: the message exists. Review it by hand.
      return typeof created?.id === "string" && created.id
        ? { kind: "delivered", messageId: created.id }
        : { kind: "review", error: "created_without_message_id" }
    }

    if (response.status === 429 || response.status >= 500) {
      return { kind: "retry", error: `provider_${response.status}` }
    }

    // 401/403/404 on an edit means the message or webhook is gone. Retrying
    // cannot help, and re-posting is forbidden.
    return { kind: "review", error: `provider_${response.status}` }
  } catch {
    // Timeout or network. Unknown, so retry — but note that a POST which
    // actually landed and timed out will be retried and could duplicate. That
    // window is why `wait=true` and the short timeout matter; see the report.
    return { kind: "retry", error: "unreachable" }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Drains due announcement mirrors. Never throws.
 *
 * Returns counts only — never a webhook URL, a message body, or an error from
 * Discord that might echo one back.
 */
export async function mirrorAnnouncements(
  env: MirrorEnv,
  options: { workerId?: string; fetchImpl?: typeof fetch; batchSize?: number } = {}
): Promise<MirrorResult> {
  const result: MirrorResult = {
    claimed: 0,
    delivered: 0,
    retracted: 0,
    edited: 0,
    retried: 0,
    stopped: 0,
    skipped: 0
  }

  const supabase = supabaseFor(env)
  const webhookUrl = env.DISCORD_ANNOUNCEMENTS_WEBHOOK_URL?.trim()
  const siteUrl = env.NEXT_PUBLIC_SITE_URL?.trim() || "https://realfiction.live"

  // FAIL CLOSED on configuration: claim nothing rather than claiming rows and
  // burning their attempt budget against a webhook that does not exist.
  if (!supabase || !webhookUrl) {
    result.skipped = 1
    return result
  }

  const fetchImpl = options.fetchImpl ?? fetch
  let rows: ClaimRow[] = []

  try {
    const { data, error } = await supabase.rpc("claim_announcement_mirrors", {
      p_worker: options.workerId ?? `cron-${Date.now()}`,
      p_limit: Math.max(1, Math.min(options.batchSize ?? 5, 25)),
      p_lease_seconds: 120
    })
    if (error) {
      return result
    }
    rows = (data ?? []) as ClaimRow[]
  } catch {
    return result
  }

  result.claimed = rows.length

  for (const row of rows) {
    // ---- Retraction. Deletes, never posts. --------------------------------
    if (row.operation === "retract") {
      if (!row.discord_message_id) {
        // Nothing to delete. Should not be claimable, but a row that reached
        // here without an id must not fall through into the mirror path below,
        // which would POST a message for an announcement we are retracting.
        try {
          await supabase.rpc("complete_announcement_retraction", {
            p_id: row.id,
            p_outcome: "deleted",
            p_error: null
          })
        } catch {
          // Bookkeeping only; the lease expires on its own.
        }
        continue
      }

      const removal = await retract(webhookUrl, row.discord_message_id, fetchImpl)

      try {
        await supabase.rpc("complete_announcement_retraction", {
          p_id: row.id,
          p_outcome: removal.kind === "deleted" ? "deleted" : removal.kind === "retry" ? "retry" : "failed",
          p_error: removal.kind === "deleted" ? null : removal.error
        })
      } catch {
        continue
      }

      if (removal.kind === "deleted") {
        result.retracted++
      } else if (removal.kind === "retry") {
        result.retried++
      } else {
        result.stopped++
      }
      continue
    }

    const announcement: AnnouncementForDiscord = {
      slug: row.slug,
      title: row.title,
      excerpt: row.excerpt,
      category: row.category,
      publishedAt: row.published_at,
      authorDisplay: row.author_display,
      imageUrl: row.image_url
    }

    const wasEdit = Boolean(row.discord_message_id)
    const outcome = await deliver(
      webhookUrl,
      buildAnnouncementPayload(announcement, siteUrl),
      row.discord_message_id,
      fetchImpl
    )

    try {
      await supabase.rpc("finish_announcement_mirror", {
        p_id: row.id,
        p_outcome: outcome.kind === "delivered" ? "delivered" : outcome.kind,
        p_message_id: outcome.kind === "delivered" ? outcome.messageId : null,
        p_content_hash: outcome.kind === "delivered" ? await contentHash(announcement) : null,
        p_error: outcome.kind === "delivered" ? null : outcome.error
      })
    } catch {
      // The lease expires on its own; a failed bookkeeping write is not a
      // delivery problem and must not abort the batch.
      continue
    }

    if (outcome.kind === "delivered") {
      result.delivered++
      if (wasEdit) {
        result.edited++
      }
    } else if (outcome.kind === "retry") {
      result.retried++
    } else {
      result.stopped++
    }
  }

  return result
}
