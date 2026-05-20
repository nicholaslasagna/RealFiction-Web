import Image from "next/image"
import Link from "next/link"
import { ArrowRight, BadgeCheck, ExternalLink, Play, ShieldCheck } from "lucide-react"

import { CopyServerButton } from "@/components/copy-server-button"
import { LivePlayerCount } from "@/components/live-player-count"
import { MotionBackground, Reveal } from "@/components/reveal"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  architectureHighlights,
  gamemodes,
  serverStats,
  storeProducts,
  trustPillars
} from "@/lib/data"

export default function HomePage() {
  const featuredProducts = storeProducts.filter((product) => product.featured)

  return (
    <>
      <section className="relative isolate overflow-hidden">
        <MotionBackground />
        <div className="pixel-grid" />
        <div className="absolute inset-0 -z-20">
          <Image
            alt="RealFiction Minecraft world"
            src="/images/hero1.png"
            fill
            priority
            className="object-cover opacity-38"
            sizes="100vw"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-background/45 via-background/78 to-background" />
        </div>

        <div className="container-shell grid min-h-[calc(100vh-80px)] items-center gap-10 py-16 lg:grid-cols-[1.1fr_0.9fr]">
          <Reveal className="max-w-4xl">
            <Badge variant="success" className="mb-5">
              <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
              0 gameplay advantages sold
            </Badge>
            <h1 className="display-font max-w-4xl text-5xl font-semibold leading-[1.04] md:text-7xl">
              RealFiction is becoming a full Minecraft platform.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">
              SMP, Factions, BedWars, Murder Mystery, Arcade, Tournaments, LobbyGames, live maps,
              Discord, voting, accounts, cosmetics, and fair server-side fulfillment in one premium ecosystem.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <CopyServerButton value="realfiction.live" label="Copy Java IP" />
              <Button asChild size="lg" variant="outline">
                <Link href="https://discord.com/invite/JkPpmzn">
                  Join Discord
                  <ExternalLink className="h-4 w-4" />
                </Link>
              </Button>
            </div>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <LivePlayerCount />
              <div className="rounded-md border border-white/15 bg-black/28 px-4 py-3 text-sm text-muted-foreground backdrop-blur">
                Bedrock: <span className="font-mono text-foreground">bedrock.realfiction.live:19132</span>
              </div>
            </div>
          </Reveal>

          <Reveal className="relative" delay={0.12}>
            <div className="premium-surface overflow-hidden rounded-lg">
              <div className="relative aspect-[4/3]">
                <Image
                  alt="RealFiction logo"
                  src="/images/rf.png"
                  fill
                  className="object-contain p-10"
                  sizes="(max-width: 1024px) 100vw, 42vw"
                />
              </div>
              <div className="grid grid-cols-2 border-t border-white/10 md:grid-cols-3">
                {serverStats.slice(0, 3).map((stat) => (
                  <div key={stat.label} className="border-r border-white/10 p-4 last:border-r-0">
                    <div className="font-mono text-xl font-semibold text-primary">{stat.value}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{stat.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="container-shell py-16">
        <Reveal className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <Badge variant="outline">Network modes</Badge>
            <h2 className="display-font mt-4 text-4xl font-semibold md:text-5xl">Built for long-term play.</h2>
          </div>
          <p className="max-w-xl text-muted-foreground">
            Each mode gets a clean identity, rule surface, stats path, map presence, and a non pay-to-win
            reward model that can scale with the server.
          </p>
        </Reveal>

        <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {gamemodes.map((mode, index) => {
            const Icon = mode.icon

            return (
              <Reveal key={mode.name} delay={index * 0.05}>
                <Link href={mode.href}>
                  <Card className="group h-full overflow-hidden transition hover:-translate-y-1 hover:border-primary/40">
                    <div className="relative aspect-[16/10] overflow-hidden">
                      <Image
                        alt={mode.name}
                        src={mode.image}
                        fill
                        className="object-cover opacity-82 transition duration-500 group-hover:scale-105"
                        sizes="(max-width: 768px) 100vw, 33vw"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/35 to-transparent" />
                      <div className="absolute bottom-4 left-4 flex items-center gap-2">
                        <span className="rounded-md border border-white/15 bg-black/40 p-2 backdrop-blur">
                          <Icon className="h-5 w-5 text-primary" />
                        </span>
                        <Badge>{mode.signal}</Badge>
                      </div>
                    </div>
                    <CardHeader>
                      <CardTitle className="flex items-center justify-between">
                        {mode.name}
                        <ArrowRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-1 group-hover:text-primary" />
                      </CardTitle>
                      <CardDescription>{mode.summary}</CardDescription>
                    </CardHeader>
                  </Card>
                </Link>
              </Reveal>
            )
          })}
        </div>
      </section>

      <section className="border-y border-white/10 bg-black/18 py-16">
        <div className="container-shell grid gap-8 lg:grid-cols-[0.85fr_1.15fr]">
          <Reveal>
            <Badge variant="warning">Store direction</Badge>
            <h2 className="display-font mt-4 text-4xl font-semibold md:text-5xl">Supporter economy, not paid power.</h2>
            <p className="mt-5 text-muted-foreground">
              The store replaces Tebex with first-party checkout, account linking, audit logs, gift cards,
              subscriptions, coupons, and plugin-backed reward queues.
            </p>
            <div className="mt-6 grid gap-3">
              {trustPillars.map((pillar) => {
                const Icon = pillar.icon
                return (
                  <div key={pillar.label} className="flex items-center gap-3 text-sm text-muted-foreground">
                    <Icon className="h-4 w-4 text-emerald-300" />
                    {pillar.label}
                  </div>
                )
              })}
            </div>
          </Reveal>

          <div className="grid gap-5 md:grid-cols-3">
            {featuredProducts.map((product, index) => (
              <Reveal key={product.id} delay={index * 0.06}>
                <Card className="h-full">
                  <CardHeader>
                    <Badge variant="success">Cosmetic</Badge>
                    <CardTitle>{product.name}</CardTitle>
                    <CardDescription>{product.summary}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button asChild variant="outline" className="w-full">
                      <Link href="/store">View store</Link>
                    </Button>
                  </CardContent>
                </Card>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="container-shell py-16">
        <Reveal className="grid gap-8 lg:grid-cols-[1fr_1fr]">
          <div className="premium-surface rounded-lg p-6 md:p-8">
            <Badge variant="outline">
              <Play className="mr-1.5 h-3.5 w-3.5" />
              Trailer
            </Badge>
            <div className="mt-5 aspect-video overflow-hidden rounded-lg border border-border bg-black/40">
              <div className="flex h-full items-center justify-center p-8 text-center">
                <div>
                  <Play className="mx-auto h-12 w-12 text-primary" />
                  <h3 className="mt-4 text-xl font-semibold">RealFiction network trailer</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Video embed slot for the launch trailer, seasonal recap, or tournament preview.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="grid content-center gap-4">
            {architectureHighlights.map((item) => (
              <div key={item.title} className="rounded-lg border border-border bg-card/55 p-5">
                <h3 className="flex items-center gap-2 font-semibold">
                  <BadgeCheck className="h-4 w-4 text-primary" />
                  {item.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.body}</p>
              </div>
            ))}
          </div>
        </Reveal>
      </section>
    </>
  )
}
