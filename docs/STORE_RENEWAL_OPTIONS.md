# Owner decision: manual renewal vs. recurring billing

**Nothing in this memo is implemented.** No recurring Stripe Price exists, none was
created, and the store ships as Option A today.

## Option A — keep manual renewal (what is built now)

One-off 1 / 3 / 6 / 12-month purchases. Stripe charges once. The entitlement
stacks: `new_expiration = max(current_expiration, now) + purchased_duration`.
RealCore grants on fulfilment and revokes when the entitlement actually expires.

**What it costs you:** revenue depends on people coming back. Expect meaningful
lapse — a player who forgets is simply gone until they notice, and the network
loses a supporter it already earned.

**What it saves you:** no dunning, no failed-payment emails, no cancellation
flow, no proration questions, no "I was charged and forgot I had it" refund
requests, and no chargeback risk from unrecognized recurring line items — which
is the single most common dispute reason for game-server subscriptions.

**The cheap win available now:** expiration reminder emails. The outbox,
templates, Resend idempotency and the scheduled Worker all already exist. A
"your RealVIP ends in 7 days" message is a small, honest piece of work and would
recover a large share of the lapse without touching billing at all. This is the
highest return-per-risk option on the table.

## Option B — add Stripe Billing subscriptions later

**Which products.** Only RealVIP and RealSupporter are worth it. The cosmetic
products are $1.99–$6.99/month; the support cost of a failed renewal on a $1.99
item exceeds the item. Recurring on cheap SKUs is where subscription businesses
lose money and goodwill simultaneously.

**Keep one-off durations.** Removing them would be a mistake: gift purchases
cannot be subscriptions, minors buying with a parent's card should not be
enrolled in recurring charges, and the 12-month one-off is genuinely the best
deal you offer. Recurring should be an *additional* choice, never a replacement,
and never preselected.

**Pricing.** Recurring monthly should not undercut the 12-month one-off, or the
one-off becomes pointless. A defensible shape is monthly recurring at the 1-month
price and annual recurring at the 12-month price.

**What it actually requires** — this is the honest scope, not a feature list:

- Recurring Prices in Stripe (new objects; the existing one-off Prices stay).
- `invoice.paid` as an entitlement-granting event, distinct from
  `checkout.session.completed`. Each paid invoice grants one period.
- `invoice.payment_failed` → grace period, dunning emails, and a defined day on
  which access actually stops. This is the part teams underestimate.
- `customer.subscription.deleted` / `.updated` → stop future grants without
  revoking the period already paid for.
- Stripe Customer Portal for self-serve cancellation. Without it, cancellation
  becomes a support queue and a chargeback source.
- Proration policy for mid-period changes, or an explicit refusal to prorate.
- Refund policy for a renewal the customer says they did not intend.
- Reconciliation between Stripe subscription periods and our entitlement dates,
  because the two clocks will drift.
- Renewal-upcoming emails. Legally advisable in several US states and simply the
  right thing to do.

**Support burden.** Realistically 2–5× the current payment support load, and the
tickets are worse: unexpected charges are angrier than failed purchases.

**Trust.** Minecraft players are unusually sensitive to this. "Does not
automatically renew" is currently a differentiator you can state plainly. Giving
it up should buy something measurable.

## Recommendation

Ship expiration reminders first and measure the recovered renewal rate. If
reminders recover most of the lapse, Option B buys you very little for a large
amount of risk and ongoing work. If they do not, revisit recurring for RealVIP
and RealSupporter only, keeping every one-off duration alongside it.

**Do not create RealFiction+, or any new membership product, as a way to
introduce recurring billing.** That was the mistake this store just recovered
from: a product invented to fit a billing model rather than a billing model
chosen to fit a product.
