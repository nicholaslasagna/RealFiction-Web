import type { Metadata } from "next"
import Link from "next/link"

import { ContactForm } from "@/components/contact-form"
import { Reveal } from "@/components/reveal"
import { DISCORD_INVITE_URL } from "@/lib/discord/counts"

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Contact RealFiction support for billing, account linking, moderation, appeals, partnerships, and help requests."
}

/**
 * A contact directory, not three cards holding one email address each.
 *
 * The old page wrapped each address in its own bordered card with an icon and a
 * heading — three panels to convey two mailboxes and a sentence. Addresses are
 * short, so they belong in a definition list where they can be read at a
 * glance, and the form keeps the space it actually needs.
 */
const CHANNELS = [
  {
    label: "Support",
    value: "support@realfiction.live",
    href: "mailto:support@realfiction.live",
    note: "Billing, account linking, bugs, player safety"
  },
  {
    label: "Business",
    value: "business@realfiction.live",
    href: "mailto:business@realfiction.live",
    note: "Partnerships, press, sponsorship"
  },
  {
    label: "Discord",
    value: "Community server",
    href: DISCORD_INVITE_URL,
    note: "Fastest for quick questions"
  }
]

export default function ContactPage() {
  return (
    <section className="container-shell py-10 md:py-14">
      <Reveal className="border-b border-amber-200/15 pb-6">
        <h1 className="display-font text-4xl font-semibold leading-tight md:text-5xl">Contact</h1>
        <p className="mt-2 max-w-2xl text-base leading-7 text-muted-foreground">
          Billing, account linking, moderation, appeals, and partnerships all reach the team here.
        </p>
      </Reveal>

      <div className="mt-8 grid gap-10 lg:grid-cols-[300px_1fr] lg:gap-16">
        <Reveal>
          <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Reach us directly
          </h2>
          <dl className="mt-3 border-t border-white/[0.06]">
            {CHANNELS.map((channel) => (
              <div key={channel.label} className="border-b border-white/[0.06] py-3">
                <dt className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  {channel.label}
                </dt>
                <dd className="mt-0.5">
                  <a
                    href={channel.href}
                    className="break-all text-sm text-amber-100 underline underline-offset-4"
                    {...(channel.href.startsWith("http")
                      ? { target: "_blank", rel: "noopener noreferrer" }
                      : {})}
                  >
                    {channel.value}
                  </a>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{channel.note}</span>
                </dd>
              </div>
            ))}
          </dl>

          <p className="mt-4 text-xs leading-5 text-muted-foreground">
            Include your Minecraft username and, for a purchase, the order ID from your receipt — it
            is the fastest way for us to find you. Refund policy lives in the{" "}
            <Link href="/terms" className="text-amber-100 underline underline-offset-4">
              terms
            </Link>
            .
          </p>
        </Reveal>

        {/* The form keeps its panel — it is a real surface with inputs and
            errors, which is exactly where a container earns its place. */}
        <Reveal delay={0.1} className="min-w-0">
          <ContactForm />
        </Reveal>
      </div>
    </section>
  )
}
