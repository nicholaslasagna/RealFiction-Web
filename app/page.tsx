import Image from "next/image"
import Link from "next/link"
import {
  ArrowRight,
  ExternalLink,
  Gem,
  HeartHandshake,
  MapPinned,
  MessageCircle,
  ShieldCheck,
  Vote
} from "lucide-react"

import { CopyServerButton } from "@/components/copy-server-button"
import { LivePlayerCount } from "@/components/live-player-count"
import { NetworkHeroStats } from "@/components/network-hero-stats"
import { Reveal } from "@/components/reveal"
import { TopPlayerSpotlight } from "@/components/top-player-spotlight"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { gamemodes, mapEndpoints } from "@/lib/data"

const supportPerks = [
  "Cosmetics",
  "RealVIP",
  "Pets",
  "Particles",
  "Username colors",
  "Lobby flight",
  "Gift cards"
]

export default function HomePage() {
  return (
    <>
      <section className="minecraft-hero relative isolate overflow-hidden">
        <div className="absolute inset-0 -z-20">
          <Image
            alt="RealFiction Minecraft landscape"
            src="/images/hero1.png"
            fill
            priority
            className="scale-105 object-cover opacity-70 blur-[3px]"
            sizes="100vw"
          />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(8,24,42,0.18),rgba(3,9,18,0.9)_66%,rgba(2,6,13,0.98))]" />
          <div className="absolute inset-0 bg-gradient-to-b from-[#04101f]/55 via-[#04101f]/60 to-background" />
          <div className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-background to-transparent" />
        </div>

        <div className="container-shell flex min-h-[calc(100svh-80px)] flex-col items-center justify-center py-16 text-center">
          <Reveal className="flex w-full max-w-3xl flex-col items-center">
            <Image
              alt="RealFiction"
              src="/images/rf.png"
              width={460}
              height={450}
              priority
              className="w-[min(320px,72vw)] drop-shadow-[0_28px_70px_rgba(0,0,0,0.7)]"
            />

            <h1 className="display-font mt-7 text-4xl font-semibold leading-tight text-white md:text-6xl">
              Welcome to RealFiction
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-8 text-slate-200/90 md:text-lg">
              A community-driven Minecraft network with Survival, Factions, Arcade, BedWars,
              Murder Mystery, events, cosmetics, voting rewards, and more.
            </p>

            <div className="mt-6">
              <LivePlayerCount />
            </div>

            <div className="minecraft-panel mt-6 w-full max-w-2xl p-5 md:p-6">
              <p className="minecraft-font text-xs uppercase tracking-[0.24em] text-amber-200/90">Java IP</p>
              <p className="mt-1 font-mono text-2xl font-semibold text-white md:text-3xl">realfiction.live</p>
              <p className="mt-2 text-sm text-slate-300/80">
                Bedrock: <span className="font-mono text-slate-200">bedrock.realfiction.live</span>
                <span className="text-slate-400"> · Port 19132</span>
              </p>

              <div className="mt-5 flex flex-col justify-center gap-3 sm:flex-row">
                <CopyServerButton value="realfiction.live" label="Copy Java IP" />
                <Button asChild size="lg" variant="outline">
                  <Link href="https://discord.com/invite/JkPpmzn">
                    <MessageCircle className="h-4 w-4" />
                    Join Our Discord
                  </Link>
                </Button>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="container-shell pt-14 md:pt-20" aria-label="Live network">
        <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
          <NetworkHeroStats />
          <TopPlayerSpotlight />
        </div>
      </section>

      <section className="container-shell py-16 md:py-20">
        <Reveal className="mx-auto max-w-3xl text-center">
          <Badge variant="outline">Choose Your Adventure</Badge>
          <h2 className="display-font mt-4 text-4xl font-semibold md:text-6xl">Worlds, games, and events with a home-server feel.</h2>
          <p className="mt-5 text-base leading-7 text-muted-foreground md:text-lg">
            Jump into long-term survival, seasonal competition, quick arcade rounds, party modes,
            and community events built around fair play.
          </p>
        </Reveal>

        <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {gamemodes.map((mode, index) => {
            const Icon = mode.icon

            return (
              <Reveal key={mode.name} delay={index * 0.04}>
                <Link href={mode.href} className="group block h-full">
                  <article className="minecraft-card h-full overflow-hidden">
                    <div className="relative aspect-[16/10] overflow-hidden">
                      <Image
                        alt={mode.name}
                        src={mode.image}
                        fill
                        className="object-cover opacity-88 transition duration-700 group-hover:scale-105"
                        sizes="(max-width: 768px) 100vw, 33vw"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-[#06101c] via-[#06101c]/28 to-transparent" />
                      <div className="absolute left-4 top-4 rounded-md border border-white/15 bg-black/42 p-2 backdrop-blur">
                        <Icon className="h-5 w-5 text-amber-200" />
                      </div>
                      <Badge className="absolute bottom-4 left-4 border-emerald-300/25 bg-emerald-300/12 text-emerald-100">
                        {mode.signal}
                      </Badge>
                    </div>
                    <div className="p-5">
                      <div className="flex items-center justify-between gap-4">
                        <h3 className="display-font text-2xl font-semibold">{mode.name}</h3>
                        <ArrowRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-1 group-hover:text-amber-200" />
                      </div>
                      <p className="mt-3 text-sm leading-6 text-muted-foreground">{mode.summary}</p>
                    </div>
                  </article>
                </Link>
              </Reveal>
            )
          })}
        </div>
      </section>

      <section className="border-y border-amber-200/10 bg-[linear-gradient(180deg,rgba(17,27,22,0.7),rgba(6,16,28,0.94))] py-16 md:py-20">
        <div className="container-shell grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <Reveal>
            <Badge variant="success">
              <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
              Support without pay-to-win
            </Badge>
            <h2 className="display-font mt-4 text-4xl font-semibold md:text-6xl">Back the server. Keep the game fair.</h2>
            <p className="mt-5 max-w-2xl text-base leading-8 text-muted-foreground md:text-lg">
              RealFiction support stays focused on style, identity, lobby fun, and community perks.
              No paid kits, no bought power, no shortcut around the rules.
            </p>
            <Button asChild className="mt-7" size="lg">
              <Link href="/store">
                Visit the Store
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </Reveal>

          <Reveal delay={0.08}>
            <div className="minecraft-panel grid gap-3 p-5 sm:grid-cols-2">
              {supportPerks.map((perk) => (
                <div key={perk} className="flex items-center gap-3 rounded-md border border-white/10 bg-black/24 p-4">
                  <Gem className="h-5 w-5 text-emerald-200" />
                  <span className="font-semibold">{perk}</span>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      <section className="container-shell py-16 md:py-20">
        <div className="grid gap-6 lg:grid-cols-3">
          <Reveal className="minecraft-card p-6 md:p-8 lg:col-span-1">
            <Vote className="h-8 w-8 text-amber-200" />
            <h2 className="display-font mt-5 text-4xl font-semibold">Vote & Earn Rewards</h2>
            <p className="mt-4 text-sm leading-7 text-muted-foreground">
              Vote daily to help RealFiction grow, build streaks, and earn server-safe rewards through
              your linked Minecraft account.
            </p>
            <Button asChild className="mt-6" variant="outline">
              <Link href="/vote">Open voting hub</Link>
            </Button>
          </Reveal>

          <Reveal className="minecraft-card p-6 md:p-8 lg:col-span-1" delay={0.05}>
            <MapPinned className="h-8 w-8 text-emerald-200" />
            <h2 className="display-font mt-5 text-4xl font-semibold">Live Maps</h2>
            <div className="mt-5 grid gap-3">
              {mapEndpoints.map((map) => (
                <Link
                  key={map.url}
                  href="/map"
                  className="flex items-center justify-between rounded-md border border-white/10 bg-black/24 px-4 py-3 text-sm text-muted-foreground transition hover:border-amber-200/35 hover:text-white"
                >
                  {map.name}
                  <ExternalLink className="h-4 w-4" />
                </Link>
              ))}
            </div>
          </Reveal>

          <Reveal className="minecraft-card p-6 md:p-8 lg:col-span-1" delay={0.1}>
            <HeartHandshake className="h-8 w-8 text-sky-200" />
            <h2 className="display-font mt-5 text-4xl font-semibold">Join the Community</h2>
            <p className="mt-4 text-sm leading-7 text-muted-foreground">
              Announcements, events, support, screenshots, and voice chat live in the RealFiction Discord.
            </p>
            <Button asChild className="mt-6" variant="outline">
              <Link href="https://discord.com/invite/JkPpmzn">
                Join Discord
                <ExternalLink className="h-4 w-4" />
              </Link>
            </Button>
          </Reveal>
        </div>
      </section>

      <section className="relative overflow-hidden border-t border-white/10 py-16">
        <Image
          alt="RealFiction adventure"
          src="/images/hero1.png"
          fill
          className="-z-20 object-cover opacity-22"
          sizes="100vw"
        />
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-background via-background/88 to-background/72" />
        <div className="container-shell">
          <Reveal className="max-w-3xl">
            <Badge variant="warning">RealFiction Network</Badge>
            <h2 className="display-font mt-4 text-4xl font-semibold md:text-6xl">A server built around players, not purchases.</h2>
            <p className="mt-5 text-base leading-8 text-muted-foreground md:text-lg">
              Explore, compete, vote, collect cosmetics, show off your profile, and stay close to the
              community that gives the network its shape.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link href="/store">Browse cosmetics</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/rules">Read the rules</Link>
              </Button>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  )
}
