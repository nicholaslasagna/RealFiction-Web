import Image from "next/image"
import Link from "next/link"

import { Separator } from "@/components/ui/separator"
import { navItems, socials } from "@/lib/data"

export function SiteFooter() {
  return (
    <footer className="relative overflow-hidden border-t border-amber-200/10 bg-[#06101c]">
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(242,198,109,0.06)_1px,transparent_1px),linear-gradient(0deg,rgba(242,198,109,0.035)_1px,transparent_1px)] bg-[size:42px_42px]" />
      <div className="container-shell py-12">
        <div className="grid gap-10 md:grid-cols-[1.2fr_0.8fr_0.8fr]">
          <div>
            <div className="flex items-center gap-3">
              <Image alt="RealFiction" src="/images/logo1.png" width={158} height={48} />
              <div>
                <div className="display-font text-lg font-semibold text-white">RealFiction</div>
                <p className="text-sm text-amber-100/70">Premium Minecraft network.</p>
              </div>
            </div>
            <p className="mt-5 max-w-xl text-sm leading-6 text-muted-foreground">
              Survival, Factions, Arcade, BedWars, Murder Mystery, events, live maps, voting rewards,
              cosmetics, and supporter perks that keep gameplay fair.
            </p>
            <div className="mt-5 rounded-md border border-amber-200/15 bg-black/24 px-4 py-3 text-sm">
              <span className="text-muted-foreground">Java IP:</span>{" "}
              <span className="font-mono font-semibold text-amber-100">realfiction.live</span>
            </div>
          </div>

          <div>
            <h3 className="minecraft-font text-sm uppercase tracking-[0.18em] text-amber-100">Explore</h3>
            <div className="mt-4 grid gap-2">
              {navItems.slice(0, 7).map((item) => (
                <Link key={item.href} className="text-sm text-muted-foreground hover:text-amber-100" href={item.href}>
                  {item.label}
                </Link>
              ))}
            </div>
          </div>

          <div>
            <h3 className="minecraft-font text-sm uppercase tracking-[0.18em] text-amber-100">Community</h3>
            <div className="mt-4 grid gap-2">
              {socials.map((item) => (
                <Link key={item.href} className="text-sm text-muted-foreground hover:text-amber-100" href={item.href}>
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        </div>

        <Separator className="my-8" />

        <div className="flex flex-col gap-3 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
          <p>© 2026 RealFiction. Not affiliated with Mojang or Microsoft.</p>
          <p>Business: business@realfiction.live · Support: support@realfiction.live</p>
        </div>
      </div>
    </footer>
  )
}
