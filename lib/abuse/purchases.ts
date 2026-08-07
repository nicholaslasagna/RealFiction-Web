import "server-only"

// Counting a COMPLETED gift-card purchase.
//
// Separate from the checkout gate on purpose. Checkout counts intent, which is
// what catches a burst of attempts; this counts money that actually moved,
// which is what the value ceilings are about. Conflating them would let a
// hundred abandoned checkouts look like a hundred purchases.
//
// Never throws. A missed counter must not turn a paid order into a failed
// fulfilment — the caller is inside the one path that grants stored value.

import { getSupabaseServiceRoleClient } from "@/lib/supabase/service-role"
import { recordAbuseEvent, resolveSubjects } from "./guard"

export async function recordGiftCardPurchase(orderId: string): Promise<void> {
  try {
    const supabase = getSupabaseServiceRoleClient()
    const { data: order } = await supabase
      .from("orders")
      .select("user_id,total_cents,metadata")
      .eq("id", orderId)
      .maybeSingle()

    const actor = order?.user_id
    if (!actor) {
      return
    }

    // The recipient comes from OUR order snapshot, taken at checkout — not from
    // anything a client sends at fulfilment time.
    const metadata = (order.metadata ?? {}) as { gift_card?: { recipient_email?: string } }

    await recordAbuseEvent(
      "gift_card_purchase",
      await resolveSubjects({
        actor: String(actor),
        recipientEmail: metadata.gift_card?.recipient_email ?? null
      }),
      Number(order.total_cents ?? 0)
    )
  } catch {
    // Deliberately silent. See the contract above.
    //
    // `resolveSubjects` now throws when the pepper is unconfigured, but that is
    // unreachable here: checkout refuses in that state, so no gift-card order
    // ever reaches fulfilment without it.
  }
}
