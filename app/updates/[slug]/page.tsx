import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, CalendarDays, Tag } from "lucide-react"

import { Reveal } from "@/components/reveal"
import { Badge } from "@/components/ui/badge"
import { updates } from "@/lib/data"
import { getAnnouncementBySlug } from "@/lib/announcements/read"
import { AnnouncementBody } from "@/components/announcement-body"

type Params = { slug: string }

/**
 * Pre-render every known update at build time so the patch-note pages
 * are static and fast. Unknown slugs fall through to notFound().
 */
/**
 * Pre-renders the LEGACY updates at build time, exactly as before.
 *
 * Canonical announcements are deliberately absent: they are published after a
 * build, so they resolve on demand instead (`dynamicParams` stays at its
 * default of true). Every existing static page keeps its build-time render.
 */
export function generateStaticParams(): Params[] {
  return updates.map((update) => ({ slug: update.slug }))
}

export async function generateMetadata({
  params
}: {
  params: Promise<Params>
}): Promise<Metadata> {
  const { slug } = await params
  const update = updates.find((entry) => entry.slug === slug)

  if (update) {
    return {
      title: `${update.title} · ${update.version}`,
      description: update.summary
    }
  }

  // Canonical announcements get the same metadata treatment as the legacy
  // pages: this URL is what /updates, /discord, and the Discord embed all link
  // to, so it is the one that gets shared and unfurled.
  const announcement = await getAnnouncementBySlug(slug)
  if (announcement) {
    return {
      title: `${announcement.title} · ${announcement.category}`,
      description: announcement.excerpt || announcement.title
    }
  }

  return {
    title: "Update not found",
    description: "This RealFiction update could not be found."
  }
}

export default async function UpdateDetailPage({
  params
}: {
  params: Promise<Params>
}) {
  const { slug } = await params
  const update = updates.find((entry) => entry.slug === slug)

  // Legacy static updates win. They were here first, their URLs are in the
  // wild, and `publish_announcement` cannot create a colliding slug without
  // somebody typing one deliberately.
  if (!update) {
    const announcement = await getAnnouncementBySlug(slug)
    if (!announcement) {
      // Drafts and future-dated rows land here too: the SQL never returned
      // them, so they 404 exactly like an unknown slug.
      notFound()
    }
    return <AnnouncementDetail announcement={announcement} />
  }

  // Previous / next in chronological order (descending by date is the
  // order in the array). Lets a reader walk through the patch notes
  // without bouncing back to the index every time.
  const index = updates.findIndex((entry) => entry.slug === slug)
  const previous = index > 0 ? updates[index - 1] : null
  const next = index < updates.length - 1 ? updates[index + 1] : null

  return (
    <section className="container-shell py-14">
      <Reveal className="max-w-3xl">
        <Link
          href="/updates"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-amber-100"
          style={{ fontFamily: "rf-bold, sans-serif", textTransform: "uppercase", letterSpacing: "0.1em" }}
        >
          <ArrowLeft className="h-4 w-4" />
          All updates
        </Link>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Badge variant="outline">{update.type}</Badge>
          <div
            className="border border-amber-200/14 bg-black/24 px-3 py-1.5 font-mono text-sm text-amber-100"
            style={{ borderRadius: 0 }}
          >
            {update.version}
          </div>
        </div>

        <h1 className="display-font mt-6 text-4xl font-semibold leading-tight md:text-6xl">
          {update.title}
        </h1>

        <p className="mt-4 text-lg leading-8 text-muted-foreground">{update.summary}</p>

        <div className="mt-4 flex flex-wrap gap-3 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays className="h-4 w-4 text-amber-200" />
            {update.date}
          </span>
          {update.tags.map((tag) => (
            <span key={tag} className="inline-flex items-center gap-1.5">
              <Tag className="h-4 w-4 text-amber-200" />
              {tag}
            </span>
          ))}
        </div>
      </Reveal>

      {/* Lead paragraph — the "what is this release" line. */}
      <Reveal className="mt-10 max-w-3xl">
        <p className="text-base leading-8 text-slate-200/95">{update.body}</p>
      </Reveal>

      {/* Patch-note sections (Added / Changed / Fixed / Notes etc.) */}
      <div className="mt-10 grid max-w-3xl gap-8">
        {update.sections.map((section) => (
          <Reveal key={section.heading}>
            <section
              className="border border-amber-200/16 bg-black/24 p-6"
              style={{ borderRadius: 0 }}
            >
              <h2
                className="text-[11px] uppercase tracking-[0.18em] text-amber-200/85"
                style={{ fontFamily: "rf-bold, sans-serif" }}
              >
                {section.heading}
              </h2>
              <ul className="mt-4 grid gap-3">
                {section.items.map((item) => (
                  <li key={item} className="flex gap-3 text-sm leading-7 text-slate-200/90">
                    <span
                      aria-hidden
                      className="mt-2 inline-block h-2 w-2 shrink-0"
                      style={{
                        background: "var(--gold)",
                        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.4), inset 0 -1px 0 rgba(0,0,0,0.2)"
                      }}
                    />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          </Reveal>
        ))}
      </div>

      {/* Prev / next pager — shown when there is something on either side. */}
      {(previous || next) && (
        <div className="mt-12 grid max-w-3xl gap-3 border-t border-amber-200/14 pt-6 sm:grid-cols-2">
          {previous ? (
            <Link
              href={`/updates/${previous.slug}`}
              className="block border border-amber-200/14 bg-black/24 p-4 transition hover:border-amber-200/35"
            >
              <div
                className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground"
                style={{ fontFamily: "rf-bold, sans-serif" }}
              >
                ← Newer
              </div>
              <div className="mt-2 text-sm font-semibold text-slate-100">{previous.title}</div>
            </Link>
          ) : (
            <div />
          )}
          {next ? (
            <Link
              href={`/updates/${next.slug}`}
              className="block border border-amber-200/14 bg-black/24 p-4 text-right transition hover:border-amber-200/35"
            >
              <div
                className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground"
                style={{ fontFamily: "rf-bold, sans-serif" }}
              >
                Older →
              </div>
              <div className="mt-2 text-sm font-semibold text-slate-100">{next.title}</div>
            </Link>
          ) : null}
        </div>
      )}
    </section>
  )
}

/**
 * A canonical announcement.
 *
 * Body text goes through `AnnouncementBody`, which renders text nodes and
 * anchors it builds itself. There is no HTML sink on this page.
 */
function AnnouncementDetail({
  announcement
}: {
  announcement: NonNullable<Awaited<ReturnType<typeof getAnnouncementBySlug>>>
}) {
  return (
    <section className="container-shell py-10 md:py-14">
      <Reveal className="max-w-3xl">
        <Link
          href="/updates"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-amber-100"
          style={{ fontFamily: "rf-bold, sans-serif", textTransform: "uppercase", letterSpacing: "0.1em" }}
        >
          <ArrowLeft className="h-4 w-4" />
          All updates
        </Link>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Badge variant="outline">{announcement.category}</Badge>
        </div>

        <h1 className="display-font mt-5 text-3xl font-semibold leading-tight md:text-5xl">
          {announcement.title}
        </h1>

        {announcement.excerpt ? (
          <p className="mt-3 text-lg leading-8 text-muted-foreground">{announcement.excerpt}</p>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-foreground">
          {announcement.publishedAt ? (
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="h-4 w-4 text-amber-200" />
              <time dateTime={announcement.publishedAt}>
                {announcement.publishedAt.slice(0, 10)}
              </time>
            </span>
          ) : null}
          {announcement.authorDisplay ? <span>{announcement.authorDisplay}</span> : null}
        </div>
      </Reveal>

      <Reveal className="mt-8 max-w-3xl">
        <AnnouncementBody body={announcement.body} imageUrl={announcement.imageUrl} />
      </Reveal>
    </section>
  )
}
