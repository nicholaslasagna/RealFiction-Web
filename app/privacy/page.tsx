import type { Metadata } from "next"

import { LegalDocument, type LegalSection } from "@/components/legal-document"

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How RealFiction collects, uses, stores, and protects your information across the website, store, and Minecraft network."
}

const UPDATED = "May 29, 2026"

const INTRO = [
  "This Privacy Policy explains what information RealFiction (“RealFiction,” “we,” “us,” or “our”) collects when you visit realfiction.live, create an account, link a Minecraft account, vote, or make a purchase, and how we use and protect that information.",
  "By using the website or the RealFiction Minecraft network you agree to the practices described here. If you do not agree, please do not use the service."
]

const SECTIONS: LegalSection[] = [
  {
    heading: "1. Who this applies to",
    body: [
      "This policy covers the RealFiction website, the web store, account and Minecraft-linking features, voting rewards, and the in-game services that connect to them. It does not cover third-party websites we link to (such as voting list sites or payment providers), which have their own privacy policies."
    ]
  },
  {
    heading: "2. Information we collect",
    body: [
      "We collect only what we need to run the network, deliver purchases and rewards, keep accounts secure, and provide support. Specifically:"
    ],
    bullets: [
      "Account information — the email address and password you use to register. Passwords are stored only as salted hashes by our authentication provider; we never see or store your plaintext password.",
      "Minecraft identity — the Minecraft username and UUID you link to your account (including Java accounts and Bedrock accounts connecting through GeyserMC), so we can deliver rewards in-game.",
      "Purchase information — the items you buy, order totals, and a payment confirmation token from our processor. Card numbers and full payment credentials are handled entirely by Stripe; RealFiction never receives or stores them.",
      "Store credit and gift cards — balances, redemptions, and related ledger entries tied to your account.",
      "Voting activity — the vote sites you use, vote timestamps, streaks, and rewards granted, as reported by the vote listing services.",
      "Support and contact messages — anything you send us through contact forms or email.",
      "Technical and usage data — IP address, browser and device type, pages viewed, and similar log data, collected automatically to operate, secure, and improve the service."
    ]
  },
  {
    heading: "3. How we use your information",
    body: ["We use the information above to:"],
    bullets: [
      "Create and maintain your account and verify your Minecraft account link.",
      "Process orders, deliver cosmetics, supporter perks, and gift-card credit, and apply voting rewards.",
      "Detect, prevent, and respond to fraud, chargebacks, abuse, and security incidents.",
      "Respond to support requests and communicate important service or policy changes.",
      "Operate, analyze, and improve the website and network."
    ]
  },
  {
    heading: "4. Cookies and similar technologies",
    body: [
      "We use strictly necessary cookies to keep you signed in and to keep your session secure. We do not sell your data or use it for cross-site advertising. Your browser settings let you block or delete cookies, but doing so may prevent you from signing in or completing checkout."
    ]
  },
  {
    heading: "5. Payments",
    body: [
      "Payments are processed by Stripe. When you check out, you provide payment details directly to the processor over their secure, PCI-compliant systems. We receive only confirmation of payment and limited transaction metadata needed to fulfill and account for your order. Please review the Stripe privacy policy for how they handle your payment data."
    ]
  },
  {
    heading: "6. How we share information",
    body: [
      "We do not sell your personal information. We share data only with the service providers that make the network work, and only as needed:"
    ],
    bullets: [
      "Hosting and database — our infrastructure and database providers store account, order, and reward data on our behalf.",
      "Content delivery and security — our CDN and edge provider helps serve the site and mitigate abuse.",
      "Payment processor — Stripe, to take payment and handle refunds, chargebacks, and disputes.",
      "Skin rendering — we request player avatar images from a public Minecraft head-rendering service using your Minecraft UUID or username so leaderboards and your profile can show your skin.",
      "Vote listing sites and Discord — when you choose to vote or connect those services.",
      "Legal compliance — when required by law, or to protect the rights, safety, and property of RealFiction, our players, or others."
    ]
  },
  {
    heading: "7. Data retention",
    body: [
      "We keep account, order, and reward records for as long as your account is active and as needed to provide the service, resolve disputes, prevent abuse, and meet legal, tax, and accounting obligations. When data is no longer needed we delete or anonymize it. You may request deletion of your account as described below."
    ]
  },
  {
    heading: "8. Security",
    body: [
      "We use industry-standard measures — encrypted connections, hashed passwords, access controls, and scoped server-side keys — to protect your information. No method of transmission or storage is perfectly secure, so we cannot guarantee absolute security, but we work to protect your data and to respond promptly to any incident.",
      "Use a strong, unique password and enable two-factor authentication in your account settings to help keep your account safe."
    ]
  },
  {
    heading: "9. Children’s privacy",
    body: [
      "RealFiction is intended for players aged 13 and older. We do not knowingly collect personal information from children under 13. If you believe a child under 13 has provided us personal information, contact us and we will delete it. If you are under the age of majority where you live, use the service and make purchases only with the involvement of a parent or guardian."
    ]
  },
  {
    heading: "10. Your rights and choices",
    body: [
      "Depending on where you live, you may have the right to access, correct, export, or delete your personal information, and to object to or restrict certain processing. You can update much of your information directly in your account settings, or email us to make a request. We will verify your identity before acting on a request and respond within the time required by applicable law.",
      "You can also unlink your Minecraft account or ask us to close your account at any time."
    ]
  },
  {
    heading: "11. International users",
    body: [
      "RealFiction is operated from, and stores data with providers in, regions that may differ from where you live. By using the service you understand your information may be processed in those locations, which may have different data-protection rules than your home country."
    ]
  },
  {
    heading: "12. Changes to this policy",
    body: [
      "We may update this Privacy Policy as the network evolves or as the law requires. When we make material changes we will update the “Last updated” date above and, where appropriate, provide additional notice. Continued use of the service after changes take effect means you accept the updated policy."
    ]
  }
]

export default function PrivacyPolicyPage() {
  return <LegalDocument title="Privacy Policy" updated={UPDATED} intro={INTRO} sections={SECTIONS} />
}
