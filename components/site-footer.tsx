import Image from "next/image"
import Link from "next/link"

import { Separator } from "@/components/ui/separator"
import { navItems, socials } from "@/lib/data"

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="container-shell py-16">
        <div className="grid gap-12 md:grid-cols-[1.2fr_0.8fr_0.8fr]">
          <div>
            <Link href="/" className="display-font text-3xl text-foreground transition hover:text-primary">
              realfiction.live
            </Link>
            <p className="mt-5 max-w-xl text-sm leading-6 text-muted-foreground">
              Survival, Factions, Arcade, BedWars, Murder Mystery, events, live maps, voting rewards,
              cosmetics, and supporter perks that keep gameplay fair.
            </p>
            <div className="mt-5 inline-flex items-center gap-2 rounded-md border border-border bg-secondary px-4 py-2 text-sm">
              <span className="text-muted-foreground">Java IP:</span>{" "}
              <span className="font-mono font-medium text-foreground">realfiction.live</span>
            </div>
          </div>

          <div>
            <h3 className="text-xs font-medium uppercase tracking-[0.10em] text-muted-foreground">Explore</h3>
            <div className="mt-4 grid gap-2.5">
              {navItems.slice(0, 7).map((item) => (
                <Link
                  key={item.href}
                  className="text-sm text-foreground transition hover:text-primary"
                  href={item.href}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-xs font-medium uppercase tracking-[0.10em] text-muted-foreground">Community</h3>
            <div className="mt-4 grid gap-2.5">
              {socials.map((item) => (
                <Link
                  key={item.href}
                  className="text-sm text-foreground transition hover:text-primary"
                  href={item.href}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        </div>

        <Separator className="my-10" />

        <div className="flex flex-col gap-3 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
          <p>© 2026 RealFiction. Not affiliated with Mojang or Microsoft.</p>
          <p className="font-mono text-xs">
            business@realfiction.live · support@realfiction.live
          </p>
        </div>
      </div>
    </footer>
  )
}
