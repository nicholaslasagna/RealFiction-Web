// DEVELOPMENT-ONLY presentation harness.
//
// There is no local Supabase on this host (Docker is unavailable), and the
// states that matter most — a legacy timed rank, an upgrade whose credit is held
// by another checkout, an order under payment review — are exactly the ones that
// are hardest to conjure against a real database without touching real data.
//
// So this renders the REAL components with fixture props. Nothing here reads a
// database, calls a provider, or knows a secret; it is the component tree the
// store and account pages render, given data.
//
// It is unreachable outside `next dev`: the guard below is evaluated on the
// server, at request time, and `notFound()` is indistinguishable from the route
// not existing. It is not linked from anywhere in the app.
import { notFound } from "next/navigation"

import { Storefront } from "@/components/storefront"
import { FairPlayPromise } from "@/components/store/fair-play"
import { OrderHistoryPreview } from "@/components/dev/order-history-preview"
import { PREVIEW_STATES, type PreviewStateId } from "@/lib/dev/preview-fixtures"

export const dynamic = "force-dynamic"

export default async function PreviewPage({ params }: { params: Promise<{ state: string }> }) {
  // Production has no preview harness. Not a flag, not a header — the route
  // simply does not resolve.
  if (process.env.NODE_ENV !== "development") {
    notFound()
  }

  const { state } = await params
  const fixture = PREVIEW_STATES[state as PreviewStateId]

  if (!fixture) {
    notFound()
  }

  return (
    <div className="container-shell py-8">
      <header className="mb-6 border-b border-amber-200/14 pb-4">
        <p className="text-[11px] uppercase tracking-[0.18em] text-amber-200/85">Preview fixture</p>
        <h2 className="display-font text-2xl">{fixture.title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{fixture.note}</p>
      </header>

      {fixture.surface === "store" ? (
        <>
          <Storefront
            signedIn={fixture.signedIn}
            linkedUsername={fixture.linkedUsername}
            entitlements={fixture.entitlements}
          />
          <div className="mt-10">
            <FairPlayPromise />
          </div>
        </>
      ) : (
        <OrderHistoryPreview orders={fixture.orders} />
      )}
    </div>
  )
}
