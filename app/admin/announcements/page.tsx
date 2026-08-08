import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { AnnouncementAdmin } from "@/components/admin/announcement-admin"
import { listAnnouncementsForStaff } from "@/lib/announcements/admin-read"
import { requireStaff } from "@/lib/announcements/staff"

export const metadata: Metadata = {
  title: "Announcements",
  // Staff-only surface: keep it out of search results entirely.
  robots: { index: false, follow: false }
}

// Per-request auth. Never cached, never prerendered.
export const dynamic = "force-dynamic"

/**
 * The staff announcement surface.
 *
 * `notFound()` rather than a redirect or a 403 for a non-staff visitor: an
 * explicit "forbidden" confirms the route exists and is worth attacking, and a
 * signed-in customer has no reason to learn that this page is here at all.
 */
export default async function AnnouncementAdminPage() {
  const staff = await requireStaff()
  if (!staff.ok) {
    notFound()
  }

  const announcements = await listAnnouncementsForStaff()

  return (
    <section className="container-shell py-10 md:py-14">
      <div className="border-b border-amber-200/15 pb-6">
        <h1 className="display-font text-3xl font-semibold leading-tight md:text-4xl">Announcements</h1>
        <p className="mt-2 max-w-2xl text-base leading-7 text-muted-foreground">
          Publishing here is authoritative. Discord receives a copy within five minutes; if it fails,
          the website announcement is unaffected.
        </p>
      </div>

      <div className="mt-8">
        <AnnouncementAdmin announcements={announcements} />
      </div>
    </section>
  )
}
