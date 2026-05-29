import type { Metadata } from "next"

import { LegalDocument, type LegalSection } from "@/components/legal-document"

export const metadata: Metadata = {
  title: "Terms & Refund Policy",
  description:
    "The terms for using RealFiction, buying cosmetic items and supporter perks, gift cards, store credit, refunds, and chargebacks."
}

const UPDATED = "May 29, 2026"

const INTRO = [
  "These Terms govern your use of the RealFiction website, web store, and Minecraft network, and your purchase of digital items from us. They include our Refund Policy. Please read them before making a purchase.",
  "By creating an account, linking a Minecraft account, or placing an order you agree to these Terms. If you do not agree, do not use the service."
]

const SECTIONS: LegalSection[] = [
  {
    heading: "1. Accounts and eligibility",
    body: [
      "You must be at least 13 years old to use RealFiction. If you are under the age of majority where you live, you may purchase only with the permission and involvement of a parent or guardian. You are responsible for activity under your account and for keeping your login credentials secure. Rewards are delivered to the Minecraft account you link, so keep your link accurate."
    ]
  },
  {
    heading: "2. What you’re buying — cosmetic only",
    body: [
      "Everything in the store is cosmetic, supporter flair, or convenience for non-combat lobby spaces. RealFiction does not sell gameplay power, competitive advantages, or anything that affects fair play. Items are digital licenses to use features on the network — you are not buying ownership of any in-game content, and access depends on your account remaining in good standing."
    ]
  },
  {
    heading: "3. Pricing and currency",
    body: [
      "Prices are listed in U.S. dollars (USD) and may change at any time. The price shown at checkout is the price you pay. You are responsible for any taxes or fees your payment provider or jurisdiction adds."
    ]
  },
  {
    heading: "4. Subscriptions and term-based perks",
    body: [
      "Some perks are sold for a set term (for example, one month, three months, six months, or a year). Unless a product clearly states it renews automatically, term-based perks are one-time purchases that expire at the end of the term and do not renew. Where a perk does renew, we will make that clear before you buy and you can cancel future renewals from your account."
    ]
  },
  {
    heading: "5. Delivery",
    body: [
      "Purchases are delivered to your linked Minecraft account, usually within a few minutes. Delivery can be delayed by payment review, server restarts, or maintenance. If a purchase hasn’t arrived after a reasonable time, check that your Minecraft account is correctly linked and contact support with your order details."
    ]
  },
  {
    heading: "6. Refund Policy",
    body: [
      "Because store items are digital and delivered quickly, all sales are generally final. We will, however, issue a refund where the law requires it, or at our discretion when:"
    ],
    bullets: [
      "You were charged more than once for the same order, or charged in error.",
      "A purchase was not delivered and we are unable to deliver it after a reasonable effort to resolve the issue.",
      "A product was materially misdescribed.",
      "A purchase was made fraudulently without the account owner’s authorization (report it to us promptly)."
    ]
  },
  {
    heading: "7. How to request a refund",
    body: [
      "Email support@realfiction.live within 14 days of your purchase with your order ID, the email used to buy, and your Minecraft username. We review each request individually and respond as quickly as we can. Approved refunds are returned to your original payment method; the item or credit purchased will be removed from your account."
    ]
  },
  {
    heading: "8. Chargebacks",
    body: [
      "If you have a problem with an order, please contact us first — we want to make it right. Opening a chargeback or payment dispute instead of contacting us may result in the affected items and credit being revoked and your account and linked Minecraft account being suspended from purchases and rewards while the dispute is reviewed. Fraudulent chargebacks may lead to a permanent ban."
    ]
  },
  {
    heading: "9. Gift cards and store credit",
    body: [
      "Gift cards and store credit are redeemable only for store purchases on RealFiction, have no cash value, and cannot be exchanged for cash except where required by law. Credit is tied to the account that redeemed it and is non-transferable. Do not share gift-card codes publicly; we are not responsible for codes that are lost, stolen, or shared."
    ]
  },
  {
    heading: "10. Acceptable use",
    body: [
      "You agree not to abuse the website or network, including by attempting to exploit the store, charge back legitimate purchases, defraud other players, evade bans, or interfere with the service. We may refuse service, cancel orders, or suspend accounts that violate these Terms or our community rules."
    ]
  },
  {
    heading: "11. Disclaimers and limitation of liability",
    body: [
      "The service is provided “as is” and “as available,” without warranties of any kind to the fullest extent permitted by law. RealFiction is not liable for indirect, incidental, or consequential damages, and our total liability for any claim relating to a purchase is limited to the amount you paid for that purchase. Some jurisdictions do not allow certain limitations, so some of these may not apply to you."
    ]
  },
  {
    heading: "12. Not affiliated with Mojang or Microsoft",
    body: [
      "RealFiction is an independent, community-run Minecraft network. It is not affiliated with, endorsed by, or sponsored by Mojang Studios, Microsoft, or any vote listing site. “Minecraft” is a trademark of Mojang Studios."
    ]
  },
  {
    heading: "13. Changes to these Terms",
    body: [
      "We may update these Terms as the network evolves or as the law requires. When we make material changes we will update the “Last updated” date above. Continued use of the service after changes take effect means you accept the updated Terms."
    ]
  }
]

export default function TermsPage() {
  return (
    <LegalDocument title="Terms & Refund Policy" updated={UPDATED} intro={INTRO} sections={SECTIONS} />
  )
}
