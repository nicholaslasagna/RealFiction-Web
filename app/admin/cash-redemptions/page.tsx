import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { readCashRedemptionsForStaff } from "@/lib/announcements/cash-redemption-admin-read"
import { requireStaff } from "@/lib/auth/staff"
import { Badge } from "@/components/ui/badge"
import { CashRedemptionActions } from "@/components/admin/cash-redemption-actions"
import { formatCurrency } from "@/lib/utils"

export const metadata: Metadata = {
  title: "Cash redemptions",
  robots: { index: false, follow: false }
}

// Per-request authorization. Never cached, never prerendered.
export const dynamic = "force-dynamic"

/** The real `email_deliveries.delivery_outcome` values, not invented ones. */
/**
 * The REAL `email_deliveries.delivery_outcome` values.
 *
 * `pending` is "Queued", not "Retrying". The queue drains on a five-minute
 * cron, so a freshly created notification sits in `pending` for up to five
 * minutes by design — that is a normal state, and labelling it as a retry made
 * a working system look broken. Only `failed_retryable` is an actual retry.
 */
const DELIVERY_LABEL: Record<string, string> = {
  pending: "Queued",
  processing: "Sending",
  sent: "Sent",
  failed_retryable: "Retry scheduled",
  failed_permanent: "Failed",
  delivery_uncertain: "Delivery uncertain",
  unconfigured: "Not configured",
  status_unavailable: "Status unavailable",
  not_queued: "Not queued"
}

function when(value: string | null) {
  return value ? String(value).slice(0, 16).replace("T", " ") : "—"
}

/**
 * The operational inbox for cash-redemption reviews.
 *
 * THIS PAGE IS THE SOURCE OF TRUTH, not the notification email. A mail-provider
 * outage delays the alert; it never hides a request. The delivery columns make
 * that visible rather than implicit — an operator can see that an email failed
 * and still work the queue.
 *
 * Rejection is the only mutation exposed here. It releases a hold through the
 * canonical resolver; no payout or direct accounting write is available.
 */
export default async function CashRedemptionAdminPage() {
  const staff = await requireStaff()
  if (!staff.ok) {
    // Same as /admin/announcements: an explicit 403 would confirm the route
    // exists and is worth attacking.
    notFound()
  }

  const queue = await readCashRedemptionsForStaff()
  const rows = queue.rows
  const open = rows.filter((row) => row.isOpen)

  return (
    <section className="container-shell py-10 md:py-14">
      <div className="border-b border-amber-200/15 pb-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="display-font text-3xl font-semibold leading-tight md:text-4xl">
            Cash redemptions
          </h1>
          <Badge
            variant={queue.ok && open.length > 0 ? "warning" : "outline"}
            data-testid="cash-redemption-open-count"
          >
            {queue.ok ? `${open.length} awaiting review` : "Queue unavailable"}
          </Badge>
        </div>
        <p className="mt-2 max-w-2xl text-base leading-7 text-muted-foreground">
          A customer&rsquo;s gift-card credit is frozen while their request is open. Closing a review
          releases or removes that hold.
        </p>
      </div>

      {!queue.ok ? (
        <p
          className="mt-8 border border-rose-200/20 bg-rose-200/[0.04] p-4 text-sm leading-6 text-rose-100"
          role="alert"
          data-testid="cash-redemption-queue-error"
        >
          The cash-redemption queue could not be read. No review action is available until the
          queue is reachable again.
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground" data-testid="cash-redemption-empty">
          No cash-redemption requests yet.
        </p>
      ) : (
        <div className="mt-8 overflow-x-auto">
          <table className="w-full min-w-[62rem] border-collapse text-sm" data-testid="cash-redemption-table">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs uppercase tracking-[0.12em] text-muted-foreground">
                <th className="py-2 pr-4 font-bold">State</th>
                <th className="py-2 pr-4 font-bold">Requester</th>
                <th className="py-2 pr-4 font-bold">Requested</th>
                <th className="py-2 pr-4 font-bold">On hold</th>
                <th className="py-2 pr-4 font-bold">Asked</th>
                <th className="py-2 pr-4 font-bold">Decided</th>
                <th className="py-2 pr-4 font-bold">Customer email</th>
                <th className="py-2 pr-4 font-bold">Admin email</th>
                <th className="py-2 font-bold">Note</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.requestId}
                  className={`border-b border-white/[0.06] align-top ${row.isOpen ? "bg-amber-200/[0.04]" : ""}`}
                  data-testid="cash-redemption-row"
                  data-open={row.isOpen ? "true" : "false"}
                >
                  <td className="py-3 pr-4">
                    <Badge variant={row.isOpen ? "warning" : "outline"}>{row.state}</Badge>
                  </td>
                  <td className="py-3 pr-4">
                    <span className="block text-slate-200">{row.minecraftUsername ?? "Not linked"}</span>
                    <span className="block text-xs text-muted-foreground">{row.claimantEmail ?? "—"}</span>
                    <span className="block font-mono text-[11px] text-muted-foreground">
                      {row.requestId.slice(0, 8)}
                    </span>
                  </td>
                  <td className="py-3 pr-4 font-mono">{formatCurrency(row.requestedCents)}</td>
                  <td className="py-3 pr-4 font-mono">
                    {row.frozenCents > 0 ? formatCurrency(row.frozenCents) : "—"}
                  </td>
                  <td className="py-3 pr-4 whitespace-nowrap text-muted-foreground">{when(row.requestedAt)}</td>
                  <td className="py-3 pr-4 whitespace-nowrap text-muted-foreground">{when(row.decidedAt)}</td>
                  <td className="py-3 pr-4 text-muted-foreground">
                    {DELIVERY_LABEL[row.customerNotified] ?? row.customerNotified}
                  </td>
                  <td className="py-3 pr-4 text-muted-foreground">
                    {DELIVERY_LABEL[row.adminNotified] ?? row.adminNotified}
                  </td>
                  <td className="py-3 text-muted-foreground">
                    {row.reviewNote ?? row.ineligibleReason ?? "—"}
                    {row.isOpen ? (
                      <CashRedemptionActions
                        requestId={row.requestId}
                        requester={row.minecraftUsername ?? row.claimantEmail ?? "Unknown"}
                        requestedCents={row.requestedCents}
                        frozenCents={row.frozenCents}
                      />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-8 border-t border-white/10 pt-5">
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          Rejecting a request releases the held store credit and emails the customer. No payout
          occurs, and nothing on this page can move money. Recording an out-of-band payout is a
          separate workflow.
        </p>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          Email status updates when the delivery worker next runs, within five minutes.
          <span className="text-slate-300"> Queued</span> is normal for a new notification.
        </p>
      </div>
    </section>
  )
}
