import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Gift Card Terms",
  description: "Terms for RealFiction gift cards and gift-card store credit."
}

/**
 * Gift card terms — DRAFT.
 *
 * Written from the owner's stated policy. It has not been through legal review,
 * and the page says so plainly rather than implying an approval that has not
 * happened. Gift cards are not purchasable, so nobody can currently agree to
 * these terms at checkout.
 */
export default function GiftCardTermsPage() {
  return (
    <section className="container-shell py-16 md:py-24">
      <div className="mx-auto max-w-2xl">
        <h1 className="display-font text-3xl font-semibold sm:text-4xl">Gift Card Terms</h1>

        <div className="mt-4 rounded-lg border border-amber-200/25 bg-amber-200/8 p-4">
          <p className="text-sm font-semibold text-amber-100">Draft — not yet in effect</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            RealFiction gift cards are not currently available for purchase. These terms are a draft
            and are subject to final legal review before any gift card is sold.
          </p>
        </div>

        <div className="mt-10 space-y-8 text-sm leading-7 text-muted-foreground">
          <section>
            <h2 className="text-lg font-semibold text-white">What a gift card is</h2>
            <p className="mt-2">
              A RealFiction gift card is prepaid store credit for the RealFiction Minecraft network.
              Once claimed, its value is added to the store-credit balance of the claiming RealFiction
              account and can be spent on eligible cosmetic and supporter products.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">No expiration and no fees</h2>
            <p className="mt-2">
              Gift cards do not expire. Gift-card store credit does not expire. There are no
              inactivity fees, maintenance fees, balance-inquiry fees, or service fees of any kind.
              The full face value remains available until it is spent.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">What it can be used for</h2>
            <p className="mt-2">
              Gift-card credit is redeemable only for eligible RealFiction products. It{" "}
              <strong className="text-white">cannot be used to purchase another gift card.</strong>{" "}
              It has no value outside the RealFiction store and cannot be transferred between
              accounts after it has been claimed.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Cash redemption</h2>
            <p className="mt-2">
              Gift cards and gift-card store credit are{" "}
              <strong className="text-white">
                not redeemable for cash except where required by law
              </strong>
              , and have no cash value beyond those legal requirements. Where a jurisdiction requires
              cash redemption of a small remaining balance, contact support and we will review the
              request.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Delivery and lost gift cards</h2>
            <p className="mt-2">
              Gift cards are delivered by email to the address chosen at purchase, immediately after
              payment. The delivery email contains a private claim link. Anyone holding that link can
              claim the card, so it should not be shared or forwarded.
            </p>
            <p className="mt-2">
              If a delivery is not received, the purchaser can contact support. We will verify the
              purchase before resending or correcting the recipient address, and doing so
              invalidates the previous claim link.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Claiming</h2>
            <p className="mt-2">
              Claiming requires a RealFiction account with a verified email address matching the
              address the card was sent to. Claiming transfers the full face value at once; the
              resulting balance can then be spent across several purchases.
            </p>
            <p className="mt-2">
              Once claimed, the value belongs to the claiming account. The purchaser cannot reverse a
              claim, view the recipient&rsquo;s balance, or see how the value was spent.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Refunds</h2>
            <p className="mt-2">
              Refund eligibility depends on the state of the card. An unclaimed gift card can be
              refunded in full, which permanently invalidates its claim link. A card that has been
              claimed but whose balance is entirely unspent may be refundable on review. Once any of
              the balance has been spent, a refund requires support review and is not automatic.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Fraud, disputes, and reversed payments</h2>
            <p className="mt-2">
              If a gift-card purchase is disputed, charged back, or found to be fraudulent, we may
              invalidate an unclaimed card, or freeze any remaining unspent value from a claimed
              card, while the matter is reviewed. Products already delivered from spent value are
              handled case by case.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Support</h2>
            <p className="mt-2">
              Questions about a gift card:{" "}
              <a className="underline hover:text-amber-100" href="mailto:support@realfiction.live">
                support@realfiction.live
              </a>
              . Please include the reference from your confirmation email — never the claim link
              itself.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Not affiliated with Mojang or Microsoft</h2>
            <p className="mt-2">
              RealFiction is not affiliated with, endorsed by, or associated with Mojang Studios or
              Microsoft. Minecraft is a trademark of Mojang Studios.
            </p>
          </section>
        </div>
      </div>
    </section>
  )
}
