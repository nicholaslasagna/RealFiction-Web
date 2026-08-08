"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { AdminAnnouncement } from "@/lib/announcements/admin-read"
import { CATEGORIES, normalizeSlug } from "@/lib/announcements/validate"

/**
 * The staff announcement editor.
 *
 * A deliberately small surface, not a CMS: a list, a form, and two buttons.
 *
 * WHAT THIS COMPONENT IS NOT TRUSTED WITH
 * =======================================
 * Nothing. Every field it sends is re-validated server-side, the staff check is
 * re-run in the route handler, and `publish` is an explicit boolean the server
 * reads rather than infers. This component holds no secret: it does not know
 * the service-role key or the Discord webhook, and there is no field through
 * which it could name one.
 *
 * The Discord column is READ-ONLY. Delivery state belongs to the mirror worker;
 * letting staff edit it from here would let a stuck row be marked delivered and
 * silently never post.
 */

type Draft = {
  slug: string
  title: string
  excerpt: string
  body: string
  category: string
  authorDisplay: string
  imageUrl: string
  mirrorToDiscord: boolean
}

const EMPTY: Draft = {
  slug: "",
  title: "",
  excerpt: "",
  body: "",
  category: "Announcement",
  authorDisplay: "",
  imageUrl: "",
  mirrorToDiscord: true
}

const DISCORD_LABEL: Record<string, string> = {
  pending: "Queued",
  delivered: "Posted",
  retrying: "Retrying",
  failed: "Failed",
  review_required: "Needs review",
  skipped: "Not mirrored",
  retract_pending: "Removing from Discord",
  retracted: "Removed from Discord",
  // The one state staff must act on: the website is private, but a message may
  // still be sitting in the channel.
  retract_failed: "Still in Discord — needs review"
}

export function AnnouncementAdmin({ announcements }: { announcements: AdminAnnouncement[] }) {
  const router = useRouter()
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null)
  // Only auto-fill the slug for a NEW announcement. Rewriting the slug of a
  // published one would orphan its URL and its Discord message.
  const [slugTouched, setSlugTouched] = useState(false)
  // Two-step confirmation, in-page. There is no dialog primitive in this
  // project, and window.confirm is unstyled, unannounced to some screen
  // readers, and impossible to test.
  const [confirmingUnpublish, setConfirmingUnpublish] = useState<string | null>(null)

  function loadForEdit(entry: AdminAnnouncement) {
    setEditing(entry.slug)
    setSlugTouched(true)
    setMessage(null)
    setDraft({
      slug: entry.slug,
      title: entry.title,
      excerpt: entry.excerpt,
      body: entry.body,
      category: entry.category,
      authorDisplay: entry.authorDisplay ?? "",
      imageUrl: entry.imageUrl ?? "",
      mirrorToDiscord: entry.mirrorToDiscord
    })
  }

  function reset() {
    setEditing(null)
    setSlugTouched(false)
    setDraft(EMPTY)
    setMessage(null)
  }

  async function save(publish: boolean) {
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch("/api/admin/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, publish })
      })
      const result = (await response.json().catch(() => ({}))) as { error?: string; status?: string }

      if (!response.ok) {
        setMessage({ tone: "error", text: result.error ?? "That could not be saved." })
        return
      }

      setMessage({
        tone: "ok",
        text: publish ? `Published. Discord receives it within five minutes.` : "Saved as a draft."
      })
      router.refresh()
      if (!publish && !editing) {
        setEditing(draft.slug)
      }
    } catch {
      setMessage({ tone: "error", text: "That could not be saved. Check your connection." })
    } finally {
      setBusy(false)
    }
  }

  async function unpublish(slug: string) {
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch("/api/admin/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unpublish", slug })
      })
      const result = (await response.json().catch(() => ({}))) as {
        error?: string
        discordState?: string
      }

      if (!response.ok) {
        setMessage({ tone: "error", text: result.error ?? "That could not be unpublished." })
        return
      }

      setMessage({
        tone: "ok",
        text:
          result.discordState === "retract_pending"
            ? "Unpublished. It is already gone from the website; the Discord copy is being removed."
            : "Unpublished. It is no longer visible on the website."
      })
      setConfirmingUnpublish(null)
      router.refresh()
    } catch {
      setMessage({ tone: "error", text: "That could not be unpublished. Check your connection." })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-12">
      {/* ---- Editor ------------------------------------------------------ */}
      <div className="min-w-0">
        <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
          {editing ? `Editing ${editing}` : "New announcement"}
        </h2>

        <div className="mt-4 space-y-4">
          <label className="block">
            <span className="text-sm text-slate-200">Title</span>
            <Input
              value={draft.title}
              maxLength={140}
              onChange={(event) => {
                const title = event.target.value
                setDraft((current) => ({
                  ...current,
                  title,
                  slug: slugTouched ? current.slug : normalizeSlug(title)
                }))
              }}
            />
          </label>

          <label className="block">
            <span className="text-sm text-slate-200">Slug</span>
            <Input
              value={draft.slug}
              maxLength={80}
              onChange={(event) => {
                setSlugTouched(true)
                setDraft((current) => ({ ...current, slug: event.target.value }))
              }}
            />
            <span className="mt-1 block text-xs text-muted-foreground">
              /updates/{draft.slug || "…"} — this is the link shared everywhere, including Discord.
              {editing ? " Changing it orphans the existing URL." : ""}
            </span>
          </label>

          <label className="block">
            <span className="text-sm text-slate-200">Excerpt</span>
            <Input
              value={draft.excerpt}
              maxLength={400}
              onChange={(event) => setDraft((current) => ({ ...current, excerpt: event.target.value }))}
            />
            <span className="mt-1 block text-xs text-muted-foreground">
              Shown on /updates, /discord, and in the Discord embed.
            </span>
          </label>

          <label className="block">
            <span className="text-sm text-slate-200">Body</span>
            <textarea
              value={draft.body}
              maxLength={20000}
              rows={12}
              onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))}
              className="mt-1 block w-full border border-white/12 bg-black/30 px-3 py-2 font-mono text-sm text-slate-200"
            />
            <span className="mt-1 block text-xs text-muted-foreground">
              Plain text. A blank line starts a paragraph; links are detected automatically. HTML is
              not rendered.
            </span>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm text-slate-200">Category</span>
              <select
                value={draft.category}
                onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))}
                className="mt-1 block h-11 w-full border border-white/12 bg-black/30 px-3 text-sm text-slate-200"
              >
                {CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-sm text-slate-200">Author shown</span>
              <Input
                value={draft.authorDisplay}
                maxLength={60}
                placeholder="RealFiction"
                onChange={(event) =>
                  setDraft((current) => ({ ...current, authorDisplay: event.target.value }))
                }
              />
            </label>
          </div>

          <label className="block">
            <span className="text-sm text-slate-200">Image path (optional)</span>
            <Input
              value={draft.imageUrl}
              maxLength={300}
              placeholder="/images/updates/season-4.png"
              onChange={(event) => setDraft((current) => ({ ...current, imageUrl: event.target.value }))}
            />
            <span className="mt-1 block text-xs text-muted-foreground">
              A path on this site. Remote URLs are rejected.
            </span>
          </label>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.mirrorToDiscord}
              onChange={(event) =>
                setDraft((current) => ({ ...current, mirrorToDiscord: event.target.checked }))
              }
              className="h-4 w-4"
            />
            <span className="text-sm text-slate-200">Post a copy to Discord</span>
          </label>

          <div className="flex flex-wrap items-center gap-3 border-t border-white/10 pt-4">
            <Button type="button" onClick={() => save(true)} disabled={busy}>
              {busy ? "Saving…" : "Publish"}
            </Button>
            <Button type="button" variant="outline" onClick={() => save(false)} disabled={busy}>
              Save draft
            </Button>
            {editing ? (
              <button
                type="button"
                onClick={reset}
                className="text-sm text-muted-foreground underline underline-offset-4"
              >
                New announcement
              </button>
            ) : null}
          </div>

          {message ? (
            <p
              role="status"
              aria-live="polite"
              className={`text-sm ${message.tone === "ok" ? "text-emerald-200" : "text-rose-200"}`}
            >
              {message.text}
            </p>
          ) : null}
        </div>
      </div>

      {/* ---- List -------------------------------------------------------- */}
      <div>
        <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
          All announcements
        </h2>
        {announcements.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Nothing yet.</p>
        ) : (
          <ul className="mt-3 border-t border-white/[0.06]">
            {announcements.map((entry) => (
              <li key={entry.id} className="border-b border-white/[0.06] py-2.5">
                <button
                  type="button"
                  onClick={() => loadForEdit(entry)}
                  className="group block w-full text-left"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm text-slate-200 group-hover:text-amber-100">
                      {entry.title}
                    </span>
                    <Badge variant={entry.status === "published" ? "success" : "outline"}>
                      {entry.status}
                    </Badge>
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span className="font-mono">{entry.slug}</span>
                    <span>·</span>
                    {/* Read-only. Delivery state belongs to the mirror worker. */}
                    <span
                      className={
                        entry.discordState === "retract_failed" ? "text-rose-200" : undefined
                      }
                    >
                      {DISCORD_LABEL[entry.discordState] ?? entry.discordState}
                    </span>
                    {entry.discordAttempts > 1 ? <span>({entry.discordAttempts} tries)</span> : null}
                  </span>
                </button>

                {/* Only a PUBLISHED announcement can be taken down. A draft is
                    already private, so offering Unpublish there is noise. */}
                {entry.status === "published" ? (
                  confirmingUnpublish === entry.slug ? (
                    <div className="mt-2 border border-rose-300/25 bg-rose-500/[0.06] p-2.5">
                      <p id={`unpublish-${entry.id}`} className="text-xs leading-5 text-rose-100">
                        Remove “{entry.title}” from the website?
                        {entry.discordState === "delivered"
                          ? " The Discord copy will be deleted too."
                          : ""}{" "}
                        Nothing is erased — it becomes a draft you can publish again.
                      </p>
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() => unpublish(entry.slug)}
                          disabled={busy}
                          aria-describedby={`unpublish-${entry.id}`}
                          className="border border-rose-300/40 bg-rose-500/15 px-2.5 py-1 text-xs font-bold text-rose-100 hover:bg-rose-500/25 disabled:opacity-50"
                        >
                          {busy ? "Unpublishing…" : "Yes, unpublish"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingUnpublish(null)}
                          className="px-2.5 py-1 text-xs text-muted-foreground underline underline-offset-4"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmingUnpublish(entry.slug)}
                      className="mt-1 text-xs text-rose-200/80 underline underline-offset-4 hover:text-rose-100"
                    >
                      Unpublish
                    </button>
                  )
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
