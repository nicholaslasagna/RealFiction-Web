import type { Metadata } from "next"
import Link from "next/link"
import { Fingerprint, History, LockKeyhole, PackageCheck, Settings, ShieldCheck, UserRound } from "lucide-react"

import { Reveal } from "@/components/reveal"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { accountPanels } from "@/lib/data"

export const metadata: Metadata = {
  title: "Account",
  description:
    "RealFiction account dashboard for Minecraft linking, purchases, cosmetics, subscriptions, votes, rewards, and security."
}

const dashboardRows = [
  { label: "Purchase history", value: "Orders, refunds, receipts", icon: History },
  { label: "Owned cosmetics", value: "Pets, particles, chat colors", icon: PackageCheck },
  { label: "Active subscriptions", value: "RealVIP and timed perks", icon: ShieldCheck },
  { label: "Security settings", value: "Sessions, email, linked accounts", icon: LockKeyhole }
]

export default function AccountPage() {
  return (
    <section className="container-shell py-14">
      <Reveal className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr]">
        <div>
          <Badge variant="default">
            <UserRound className="mr-1.5 h-3.5 w-3.5" />
            Account ecosystem
          </Badge>
          <h1 className="display-font mt-5 text-5xl font-semibold leading-tight md:text-6xl">Dashboard</h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
            Supabase Auth becomes the identity layer for purchases, Minecraft linking, vote history,
            reward claims, gift card balances, profile customization, and support security.
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href="/store">Start with store</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/vote">View voting</Link>
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <Badge variant="success">Supabase Auth</Badge>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>Email magic links, OAuth providers, and future Minecraft verification codes.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Input placeholder="email@example.com" type="email" />
            <Button type="button">
              <Fingerprint className="h-4 w-4" />
              Request sign-in link
            </Button>
            <p className="text-sm text-muted-foreground">
              Auth is scaffolded for Supabase. Environment variables and redirect URLs are configured during deployment.
            </p>
          </CardContent>
        </Card>
      </Reveal>

      <Reveal className="mt-10 grid gap-5 md:grid-cols-2">
        {accountPanels.map((panel) => (
          <Card key={panel.title}>
            <CardHeader>
              <Badge variant="outline">{panel.status}</Badge>
              <CardTitle>{panel.title}</CardTitle>
              <CardDescription>{panel.body}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </Reveal>

      <Reveal className="mt-10">
        <div className="premium-surface rounded-lg p-6 md:p-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <Badge variant="warning">
                <Settings className="mr-1.5 h-3.5 w-3.5" />
                Dashboard modules
              </Badge>
              <h2 className="mt-4 text-2xl font-semibold">Production account surface</h2>
            </div>
            <Button asChild variant="outline">
              <Link href="/contact">Need support</Link>
            </Button>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {dashboardRows.map((row) => {
              const Icon = row.icon

              return (
                <div key={row.label} className="rounded-lg border border-border bg-background/45 p-5">
                  <Icon className="h-5 w-5 text-primary" />
                  <h3 className="mt-4 font-semibold">{row.label}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{row.value}</p>
                </div>
              )
            })}
          </div>
        </div>
      </Reveal>
    </section>
  )
}
