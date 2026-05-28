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
      {/* ───── HERO ─────────────────────────────────────────────── */}
      <section className="relative isolate overflow-hidden bg-background">
        <div className="container-shell flex min-h-[calc(100svh-64px)] flex-col items-center justify-center py-20 text-center">
          <Reveal className="flex w-full max-w-3xl flex-col items-center">
            <div className="mb-8">
              <LivePlayerCount />
            </div>

            <h1 className="display-font text-5xl leading-[1.02] tracking-[-0.028em] text-foreground md:text-7xl lg:text-[88px]">
              Welcome to RealFiction
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-7 text-muted-foreground md:text-lg">
              A community-driven Minecraft network with Survival, Factions, Arcade, BedWars,
              Murder Mystery, events, cosmetics, voting rewards, and more.
            </p>

            <div className="mt-8 flex flex-col items-center gap-3">
              <div className="inline-flex items-center gap-2 rounded-md border border-border bg-secondary px-4 py-2">
                <span className="text-xs uppercase tracking-[0.10em] text-muted-foreground">Java</span>
                <span className="font-mono text-sm font-medium text-foreground">realfiction.live</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Bedrock: <span className="font-mono text-foreground">bedrock.realfiction.live</span>
                <span className="text-muted-foreground"> · Port 19132</span>
              </p>
            </div>

            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <CopyServerButton value="realfiction.live" label="Copy Java IP" />
              <Button asChild size="lg" variant="outline">
                <Link href="https://discord.com/invite/JkPpmzn">
                  <MessageCircle className="h-4 w-4" />
                  Join Our Discord
                </Link>
              </Button>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ───── LIVE NETWORK STATS ───────────────────────────────── */}
      <section className="container-shell py-20 md:py-24" aria-label="Live network">
        <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
          <NetworkHeroStats />
          <TopPlayerSpotlight />
        </div>
      </section>

      {/* ───── CHOOSE YOUR ADVENTURE ────────────────────────────── */}
      <section className="bg-secondary py-24 md:py-28">
        <div className="container-shell">
          <Reveal className="mx-auto max-w-3xl text-center">
            <span className="rf-kicker">Choose Your Adventure</span>
            <h2 className="display-font mt-5 text-4xl leading-[1.05] tracking-[-0.025em] text-foreground md:text-6xl">
              Worlds, games, and events with a home-server feel.
            </h2>
            <p className="mt-5 text-base leading-7 text-muted-foreground md:text-lg">
              Jump into long-term survival, seasonal competition, quick arcade rounds, party modes,
              and community events built around fair play.
            </p>
          </Reveal>

          <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {gamemodes.map((mode, index) => {
              const Icon = mode.icon

              return (
                <Reveal key={mode.name} delay={index * 0.04}>
                  <Link href={mode.href} className="group block h-full">
                    <article className="minecraft-card flex h-full flex-col overflow-hidden">
                      <div className="relative aspect-[16/10] overflow-hidden">
                        <Image
                          alt={mode.name}
                          src={mode.image}
                          fill
                          className="object-cover transition duration-700 group-hover:scale-105"
                          sizes="(max-width: 768px) 100vw, 33vw"
                        />
                        <div className="absolute left-4 top-4 grid h-9 w-9 place-items-center rounded-md border border-border bg-card backdrop-blur-sm">
                          <Icon className="h-5 w-5 text-foreground" />
                        </div>
                      </div>
                      <div className="flex flex-1 flex-col p-6">
                        <div className="text-xs font-medium uppercase tracking-[0.10em] text-primary">
                          {mode.signal}
                        </div>
                        <div className="mt-2 flex items-start justify-between gap-4">
                          <h3 className="display-font text-2xl text-foreground">{mode.name}</h3>
                          <ArrowRight className="mt-1 h-4 w-4 text-muted-foreground transition group-hover:translate-x-1 group-hover:text-primary" />
                        </div>
                        <p className="mt-3 text-sm leading-6 text-muted-foreground">{mode.summary}</p>
                      </div>
                    </article>
                  </Link>
                </Reveal>
              )
            })}
          </div>
        </div>
      </section>

      {/* ───── SUPPORT — no pay-to-win ──────────────────────────── */}
      <section className="py-24 md:py-28">
        <div className="container-shell grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <Reveal>
            <Badge variant="success">
              <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
              Support without pay-to-win
            </Badge>
            <h2 className="display-font mt-5 text-4xl leading-[1.05] tracking-[-0.025em] text-foreground md:text-6xl">
              Back the server. Keep the game fair.
            </h2>
            <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground md:text-lg">
              RealFiction support stays focused on style, identity, lobby fun, and community perks.
              No paid kits, no bought power, no shortcut around the rules.
            </p>
            <Button asChild className="mt-8" size="lg">
              <Link href="/store">
                Visit the Store
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </Reveal>

          <Reveal delay={0.08}>
            <div className="grid gap-3 sm:grid-cols-2">
              {supportPerks.map((perk) => (
                <div
                  key={perk}
                  className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 transition hover:border-primary"
                >
                  <div className="grid h-9 w-9 place-items-center rounded-full bg-primary/10">
                    <Gem className="h-4 w-4 text-primary" />
                  </div>
                  <span className="text-sm font-medium text-foreground">{perk}</span>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ───── VOTE · LIVE MAPS · COMMUNITY TRIO ────────────────── */}
      <section className="bg-secondary py-24 md:py-28">
        <div className="container-shell">
          <div className="grid gap-6 lg:grid-cols-3">
            <Reveal className="minecraft-card p-7 md:p-8 lg:col-span-1">
              <div className="grid h-11 w-11 place-items-center rounded-full bg-primary/10">
                <Vote className="h-5 w-5 text-primary" />
              </div>
              <h2 className="display-font mt-5 text-3xl text-foreground">Vote &amp; Earn Rewards</h2>
              <p className="mt-4 text-sm leading-7 text-muted-foreground">
                Vote daily to help RealFiction grow, build streaks, and earn server-safe rewards through
                your linked Minecraft account.
              </p>
              <Button asChild className="mt-6" variant="outline" size="sm">
                <Link href="/vote">Open voting hub</Link>
              </Button>
            </Reveal>

            <Reveal className="minecraft-card p-7 md:p-8 lg:col-span-1" delay={0.05}>
              <div className="grid h-11 w-11 place-items-center rounded-full bg-primary/10">
                <MapPinned className="h-5 w-5 text-primary" />
              </div>
              <h2 className="display-font mt-5 text-3xl text-foreground">Live Maps</h2>
              <div className="mt-5 grid gap-2">
                {mapEndpoints.map((map) => (
                  <Link
                    key={map.url}
                    href="/map"
                    className="flex items-center justify-between rounded-md border border-border bg-background px-4 py-2.5 text-sm text-muted-foreground transition hover:border-primary hover:text-foreground"
                  >
                    {map.name}
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                ))}
              </div>
            </Reveal>

            <Reveal className="minecraft-card p-7 md:p-8 lg:col-span-1" delay={0.1}>
              <div className="grid h-11 w-11 place-items-center rounded-full bg-primary/10">
                <HeartHandshake className="h-5 w-5 text-primary" />
              </div>
              <h2 className="display-font mt-5 text-3xl text-foreground">Join the Community</h2>
              <p className="mt-4 text-sm leading-7 text-muted-foreground">
                Announcements, events, support, screenshots, and voice chat live in the RealFiction Discord.
              </p>
              <Button asChild className="mt-6" variant="outline" size="sm">
                <Link href="https://discord.com/invite/JkPpmzn">
                  Join Discord
                  <ExternalLink className="h-4 w-4" />
                </Link>
              </Button>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ───── FINAL CTA ─────────────────────────────────────────── */}
      <section className="py-24 md:py-28">
        <div className="container-shell">
          <Reveal className="mx-auto max-w-3xl text-center">
            <span className="rf-kicker">RealFiction Network</span>
            <h2 className="display-font mt-5 text-4xl leading-[1.04] tracking-[-0.025em] text-foreground md:text-6xl">
              A server built around players, not purchases.
            </h2>
            <p className="mt-5 text-base leading-7 text-muted-foreground md:text-lg">
              Explore, compete, vote, collect cosmetics, show off your profile, and stay close to the
              community that gives the network its shape.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
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
