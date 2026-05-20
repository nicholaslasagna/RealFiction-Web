import Image from "next/image"
import Link from "next/link"

import { Separator } from "@/components/ui/separator"
import { navItems, socials } from "@/lib/data"

export function SiteFooter() {
  return (
    <footer className="border-t border-white/10 bg-black/20">
      <div className="container-shell py-12">
        <div className="grid gap-10 md:grid-cols-[1.2fr_0.8fr_0.8fr]">
          <div>
            <div className="flex items-center gap-3">
              <Image alt="RealFiction" src="/images/logo1.png" width={122} height={38} />
              <div>
                <div className="display-font text-lg font-semibold">RealFiction</div>
                <p className="text-sm text-muted-foreground">Minecraft platform and community ecosystem.</p>
              </div>
            </div>
            <p className="mt-5 max-w-xl text-sm leading-6 text-muted-foreground">
              Cosmetics, supporter identity, profile customization, lobby perks, voting, maps, updates,
              account linking, and fair server-side fulfillment for the RealFiction network.
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-foreground">Platform</h3>
            <div className="mt-4 grid gap-2">
              {navItems.slice(0, 7).map((item) => (
                <Link key={item.href} className="text-sm text-muted-foreground hover:text-foreground" href={item.href}>
                  {item.label}
                </Link>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-foreground">Community</h3>
            <div className="mt-4 grid gap-2">
              {socials.map((item) => (
                <Link key={item.href} className="text-sm text-muted-foreground hover:text-foreground" href={item.href}>
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
