import Link from "next/link"

import { Reveal } from "@/components/reveal"

/**
 * Shared presentation for long-form legal pages (Privacy Policy, Terms &
 * Refund Policy). Renders a centered, readable column with the site's
 * pixel display font for headings and muted body copy. Content is passed
 * as structured sections so each policy page stays just data + this layout.
 */

export type LegalSection = {
  heading: string
  /** Paragraphs rendered in order. */
  body?: string[]
  /** Optional bullet list rendered after the paragraphs. */
  bullets?: string[]
}

export function LegalDocument({
  title,
  updated,
  intro,
  sections
}: {
  title: string
  updated: string
  intro: string[]
  sections: LegalSection[]
}) {
  return (
    <section className="container-shell py-12 md:py-16">
      <Reveal className="mx-auto max-w-3xl">
        <Link
          href="/"
          className="text-sm font-semibold text-amber-200 underline-offset-4 hover:underline"
        >
          ← Back to RealFiction
        </Link>

        <h1 className="display-font mt-5 text-4xl font-semibold leading-tight md:text-5xl">
          {title}
        </h1>
        <p className="mt-3 text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Last updated {updated}
        </p>

        <div className="mt-6 space-y-4">
          {intro.map((paragraph, index) => (
            <p key={index} className="text-base leading-7 text-muted-foreground">
              {paragraph}
            </p>
          ))}
        </div>

        <div className="mt-10 space-y-9">
          {sections.map((section) => (
            <section key={section.heading} className="space-y-3">
              <h2 className="display-font text-2xl font-semibold text-white">{section.heading}</h2>
              {section.body?.map((paragraph, index) => (
                <p key={index} className="text-base leading-7 text-muted-foreground">
                  {paragraph}
                </p>
              ))}
              {section.bullets ? (
                <ul className="space-y-2 pl-1">
                  {section.bullets.map((item, index) => (
                    <li key={index} className="flex gap-2.5 text-base leading-7 text-muted-foreground">
                      <span aria-hidden className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-sm bg-amber-300/70" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </div>

        <div className="mt-12 rounded-lg border border-amber-200/14 bg-black/24 p-5 text-sm leading-6 text-muted-foreground">
          Questions about this document? Email{" "}
          <a
            href="mailto:support@realfiction.live"
            className="font-semibold text-amber-200 underline-offset-2 hover:underline"
          >
            support@realfiction.live
          </a>{" "}
          (general) or{" "}
          <a
            href="mailto:business@realfiction.live"
            className="font-semibold text-amber-200 underline-offset-2 hover:underline"
          >
            business@realfiction.live
          </a>{" "}
          (business). RealFiction is a community Minecraft network and is not affiliated with
          Mojang Studios or Microsoft.
        </div>
      </Reveal>
    </section>
  )
}
