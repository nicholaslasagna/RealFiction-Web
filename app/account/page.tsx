import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import type { ComponentType } from "react"
import {
  CalendarDays,
  Clock,
  Gift
} from "lucide-react"

import { AccountAuthCard } from "@/components/account-auth-card"
import { AccountEconomyCard } from "@/components/account-economy-card"
import { AccountLinkCard } from "@/components/account-link-card"
import { AccountSignOutButton } from "@/components/account-sign-out-button"
import { GiftCardCodes } from "@/components/gift-card-codes"
import {
  BoneIcon,
  CheckIcon,
  ClockIcon,
  CompassIcon,
  DyeIcon,
  ElytraIcon,
  EmeraldIcon,
  FireworkRocketIcon,
  GearIcon,
  GrassBlockIcon,
  NetherStarIcon,
  SteveHeadIcon,
  WarningIcon
} from "@/components/minecraft-icons"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { voteSites } from "@/lib/data"
import { createSupabaseServerClient, getAuthenticatedUser } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Account",
  description:
    "Sign in or create a RealFiction account for Minecraft linking, cosmetics, purchases, voting rewards, and support."
}

type MinecraftLink = {
  id: string
  minecraft_uuid: string | null
  minecraft_username: string | null
  platform: string | null
  status: "pending" | "verified" | "revoked" | "expired"
  verified_at: string | null
  expires_at: string | null
  created_at: string | null
}

type ProductRef = {
  slug?: string | null
  name?: string | null
  category?: string | null
}

type EntitlementRow = {
  id: string
  entitlement_key: string
  status: string
  expires_at: string | null
  products?: ProductRef | ProductRef[] | null
}

type OrderItemRow = {
  quantity: number
  product_snapshot?: {
    name?: string
    slug?: string
  } | null
}

type OrderRow = {
  id: string
  status: string
  total_cents: number
  currency: string
  created_at: string
  paid_at: string | null
  gifted_to_minecraft_username?: string | null
  store_credit_applied_cents?: number | null
  payment_due_cents?: number | null
  order_items?: OrderItemRow[] | null
}

type RewardRow = {
  id: string
  source: string
  reward_key: string
  status: string
  created_at: string
  delivered_at: string | null
  failed_at: string | null
  payload?: {
    displayName?: string
    productName?: string
    description?: string
    vote_site?: string
    milestone?: number
    monthly_votes?: number
  } | null
}

type VoteStreakRow = {
  current_streak: number
  longest_streak: number
  monthly_votes: number
  total_votes: number
  last_vote_at: string | null
  minecraft_username: string
}

type GiftCardRow = {
  id: string
  code: string | null
  balance_cents: number
  original_balance_cents: number
  status: string
  created_at: string
  redeemed_at: string | null
}

type AccountData = {
  links: MinecraftLink[]
  entitlements: EntitlementRow[]
  orders: OrderRow[]
  rewards: RewardRow[]
  giftCards: GiftCardRow[]
  voteStreak: VoteStreakRow | null
  failed: boolean
}

const perkCards = [
  {
    // RealSupporter is the higher supporter tier and includes RealVIP-level
    // benefits, so owning it lights up both cards; RealVIP alone lights up only
    // RealVIP.
    key: "vip",
    title: "RealVIP",
    text: "Supporter flair, friendly extras, and community perks.",
    slugs: ["realvip", "real-supporter"],
    icon: NetherStarIcon
  },
  {
    key: "supporter",
    title: "RealSupporter",
    text: "Top supporter flair, Discord sync, cosmetic drops, and profile style.",
    slugs: ["real-supporter"],
    icon: EmeraldIcon
  },
  {
    key: "flight",
    title: "Lobby Flight",
    text: "Fly in the lobby and explore spawn in style.",
    slugs: ["lobby-flight"],
    icon: ElytraIcon
  },
  {
    key: "pets",
    title: "Pets",
    text: "Bring a fun lobby companion with you.",
    slugs: ["realpets"],
    icon: BoneIcon
  },
  {
    key: "particles",
    title: "Particles",
    text: "Show off trails, auras, and sparkles.",
    slugs: ["particle-vault", "cosmetic-atelier"],
    icon: FireworkRocketIcon
  },
  {
    key: "colors",
    title: "Username Colors",
    text: "Pick a name color that fits your style.",
    slugs: ["username-colors", "cosmetic-atelier"],
    icon: DyeIcon
  }
]

function getProduct(row: EntitlementRow): ProductRef | null {
  if (!row.products) {
    return null
  }

  return Array.isArray(row.products) ? row.products[0] ?? null : row.products
}

function entitlementSlug(row: EntitlementRow) {
  const product = getProduct(row)
  return product?.slug ?? row.entitlement_key.replace(/^product:/, "")
}

// Subscription SKUs are <base>-1m/-3m/-6m/-12m; collapse to the base so a perk
// counts as owned regardless of the purchased term.
function baseSlug(slug: string) {
  return slug.replace(/-(1m|3m|6m|12m)$/, "")
}

function formatDate(value: string | null) {
  if (!value) {
    return "Not yet"
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value))
}

function formatMoney(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD"
  }).format(cents / 100)
}

function orderLabel(status: string) {
  const labels: Record<string, string> = {
    draft: "Not started",
    pending: "Waiting for checkout",
    paid: "Almost ready",
    fulfilled: "Ready in-game",
    refunded: "Refunded",
    chargeback: "Closed",
    cancelled: "Cancelled"
  }

  return labels[status] ?? "Checking"
}

function rewardLabel(status: string) {
  const labels: Record<string, string> = {
    pending: "Queued for delivery",
    processing: "Waiting for player login",
    delivered: "Delivered",
    failed: "Needs help",
    cancelled: "Cancelled"
  }

  return labels[status] ?? "Checking"
}

// Pixel-art status chips — a green check when it's done, an amber warning sign
// when it needs help, an hourglass-style clock while it's in flight.
function OrderStatusBadge({ status }: { status: string }) {
  const Icon = status === "fulfilled" ? CheckIcon : status === "refunded" || status === "chargeback" ? WarningIcon : ClockIcon
  const variant: "success" | "warning" | "outline" =
    status === "fulfilled" ? "success" : status === "refunded" || status === "chargeback" ? "warning" : "outline"
  return (
    <Badge variant={variant}>
      <Icon size={12} />
      {orderLabel(status)}
    </Badge>
  )
}

function RewardStatusBadge({ status }: { status: string }) {
  const Icon = status === "delivered" ? CheckIcon : status === "failed" ? WarningIcon : ClockIcon
  const variant: "success" | "warning" | "outline" =
    status === "delivered" ? "success" : status === "failed" ? "warning" : "outline"
  return (
    <Badge variant={variant}>
      <Icon size={12} />
      {rewardLabel(status)}
    </Badge>
  )
}

const voteRewardAmounts: Record<string, number> = {
  "vote.standard": 250,
  "vote.milestone.5": 500,
  "vote.milestone.15": 1000,
  "vote.milestone.30": 1500,
  "vote.milestone.75": 2500
}

const voteSiteNames: Record<string, string> = {
  "minecraftservers-org": "MinecraftServers.org",
  planetminecraft: "PlanetMinecraft",
  "minecraft-mp": "Minecraft-MP",
  topg: "TopG",
  "minecraft-menu": "Minecraft Menu",
  "servers-minecraft": "Servers-Minecraft",
  "minecraft-buzz": "Minecraft.Buzz",
  curseforge: "CurseForge",
  "mclist-io": "mclist.io",
  mcsl: "MCSL"
}

function voteSiteName(slug?: string | null) {
  if (!slug) {
    return "a vote site"
  }

  return voteSiteNames[slug] ?? slug.replace(/[-_]/g, " ")
}

function rewardTitle(row: RewardRow) {
  if (row.reward_key === "vote.standard") {
    return `Voted on ${voteSiteName(row.payload?.vote_site)}`
  }

  if (row.reward_key.startsWith("vote.milestone.")) {
    const milestone = row.payload?.milestone ?? Number(row.reward_key.replace("vote.milestone.", ""))
    return `${milestone} vote bonus`
  }

  if (row.payload?.displayName) {
    return row.payload.displayName
  }

  if (row.payload?.productName) {
    return row.payload.productName
  }

  return row.reward_key
    .replace(/^product:/, "")
    .replace(/^vote\./, "Vote reward ")
    .replace(/[._-]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function rewardDetail(row: RewardRow) {
  const amount = voteRewardAmounts[row.reward_key]
  if (amount) {
    return `Earned $${amount}`
  }

  return row.payload?.description ?? formatDate(row.created_at)
}

async function getAccountData(): Promise<AccountData> {
  try {
    const supabase = await createSupabaseServerClient()
    const [linksResult, entitlementsResult, ordersResult, rewardsResult, giftCardsResult, votesResult] = await Promise.all([
      supabase
        .from("minecraft_account_links")
        .select("id,minecraft_uuid,minecraft_username,platform,status,verified_at,expires_at,created_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("entitlements")
        .select("id,entitlement_key,status,expires_at,products(slug,name,category)")
        .eq("status", "active")
        .order("created_at", { ascending: false }),
      // Only real purchases — abandoned pre-payment orders (status "pending"/
      // "draft") and cancelled ones never reached checkout, so they aren't
      // shown here (the live cart on the store page is where in-progress items
      // live).
      supabase
        .from("orders")
        .select("id,status,total_cents,currency,created_at,paid_at,gifted_to_minecraft_username,store_credit_applied_cents,payment_due_cents,order_items(quantity,product_snapshot)")
        .in("status", ["paid", "fulfilled", "refunded", "chargeback"])
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("reward_queue")
        .select("id,source,reward_key,status,created_at,delivered_at,failed_at,payload")
        .order("created_at", { ascending: false })
        .limit(50),
      // Gift cards the signed-in user purchased (owner-read RLS). Lets them
      // reveal/copy the code from their account page.
      supabase
        .from("gift_cards")
        .select("id,code,balance_cents,original_balance_cents,status,created_at,redeemed_at")
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("vote_streaks")
        .select("current_streak,longest_streak,monthly_votes,total_votes,last_vote_at,minecraft_username")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    ])

    const failed = Boolean(
      linksResult.error ||
        entitlementsResult.error ||
        ordersResult.error ||
        rewardsResult.error ||
        votesResult.error
    )

    return {
      links: (linksResult.data ?? []) as MinecraftLink[],
      entitlements: (entitlementsResult.data ?? []) as EntitlementRow[],
      orders: (ordersResult.data ?? []) as OrderRow[],
      rewards: (rewardsResult.data ?? []) as RewardRow[],
      // Gift cards are best-effort — never fail the whole page if the lifecycle
      // migration hasn't landed in the target DB yet.
      giftCards: (giftCardsResult.data ?? []) as GiftCardRow[],
      voteStreak: (votesResult.data ?? null) as VoteStreakRow | null,
      failed
    }
  } catch {
    return {
      links: [],
      entitlements: [],
      orders: [],
      rewards: [],
      giftCards: [],
      voteStreak: null,
      failed: true
    }
  }
}

async function getAccountUser() {
  try {
    return await getAuthenticatedUser()
  } catch {
    return null
  }
}

export default async function AccountPage() {
  const user = await getAccountUser()

  return (
    <section className="relative isolate min-h-screen overflow-hidden">
      <div className="absolute inset-0 -z-30">
        <Image
          alt=""
          aria-hidden="true"
          src="/images/hero2.png"
          fill
          priority
          className="scale-105 object-cover opacity-44 blur-[2px]"
          sizes="100vw"
        />
      </div>
      <div className="absolute inset-0 -z-20 bg-[radial-gradient(circle_at_50%_46%,rgba(242,198,109,0.18),transparent_27rem),radial-gradient(circle_at_70%_72%,rgba(129,55,116,0.38),transparent_36rem),linear-gradient(135deg,rgba(6,16,28,0.82),rgba(42,21,55,0.78),rgba(6,16,28,0.94))]" />
      <div className="pixel-grid opacity-30" />

      <div className="container-shell flex min-h-screen flex-col">
        <header className="flex h-24 items-center justify-between gap-4">
          <Link className="flex items-center gap-3" href="/">
            <Image
              alt="RealFiction"
              src="/images/logo1.png"
              width={174}
              height={54}
              className="drop-shadow-[0_12px_28px_rgba(0,0,0,0.5)]"
            />
          </Link>
          <div className="flex items-center gap-2">
            <Link
              className="inline-flex items-center gap-2 rounded-md border border-white/12 bg-black/24 px-3 py-2 text-sm font-semibold text-muted-foreground backdrop-blur transition hover:border-amber-200/35 hover:text-amber-100"
              href="/"
            >
              <CompassIcon className="h-4 w-4" />
              Home
            </Link>
            {user ? (
              <Link
                className="inline-flex items-center gap-2 rounded-md border border-white/12 bg-black/24 px-3 py-2 text-sm font-semibold text-muted-foreground backdrop-blur transition hover:border-amber-200/35 hover:text-amber-100"
                href="/account/settings"
              >
                <GearIcon className="h-4 w-4" />
                Settings
              </Link>
            ) : null}
            {user ? <AccountSignOutButton /> : null}
          </div>
        </header>

        {user ? <SignedInAccount /> : <SignedOutAccount />}
      </div>
    </section>
  )
}

function SignedOutAccount() {
  return (
    <div className="flex flex-1 items-center justify-center py-8">
      <div className="flex w-full flex-col items-center">
        <AccountAuthCard />
      </div>
    </div>
  )
}

async function SignedInAccount() {
  const data = await getAccountData()
  const verifiedLink = data.links.find((link) => link.status === "verified")
  const pendingLink = data.links.find((link) => link.status === "pending")
  const ownedSlugs = new Set(data.entitlements.map((row) => baseSlug(entitlementSlug(row))))
  const ownedCount = perkCards.filter((perk) => perk.slugs.some((slug) => ownedSlugs.has(slug))).length

  return (
    <main className="pb-12 md:pb-16">
      <div className="mx-auto max-w-6xl py-6 md:py-10">
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <section className="space-y-6">
            <div className="minecraft-panel rounded-lg p-6 md:p-8">
              <h1 className="display-font text-5xl font-semibold leading-tight text-white md:text-6xl">
                Welcome back
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
                Keep track of your Minecraft link, perks, vote streak, and recent rewards in one cozy place.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Button asChild>
                  <Link href="/vote">Vote for Rewards</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/store">Visit Store</Link>
                </Button>
              </div>
            </div>

            {data.failed ? (
              <Card className="minecraft-card border-amber-300/20">
                <CardHeader>
                  <CardTitle>Some account details are still loading</CardTitle>
                  <CardDescription>
                    Try refreshing the page. Your in-game rewards are still safe.
                  </CardDescription>
                </CardHeader>
              </Card>
            ) : null}

            <AccountLinkCard
              linked={Boolean(verifiedLink)}
              minecraftUsername={verifiedLink?.minecraft_username}
              minecraftUuid={verifiedLink?.minecraft_uuid}
              pendingUsername={pendingLink?.minecraft_username}
            />

            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {perkCards.map((perk) => {
                const unlocked = perk.slugs.some((slug) => ownedSlugs.has(slug))
                const Icon = perk.icon

                return (
                  <Card
                    key={perk.key}
                    className={unlocked ? "minecraft-card border-emerald-300/18" : "minecraft-card"}
                  >
                    <CardHeader>
                      <div className="flex items-center justify-between gap-3">
                        <span className="flex h-11 w-11 items-center justify-center border-2 border-[#00060e] bg-gradient-to-b from-[#1a2638] to-[#0a1424] shadow-[inset_0_2px_0_rgba(255,255,255,0.08),inset_0_-2px_0_rgba(0,0,0,0.3)]">
                          <Icon size={22} />
                        </span>
                        <Badge variant={unlocked ? "success" : "outline"}>
                          {unlocked ? "Owned" : "Locked"}
                        </Badge>
                      </div>
                      <CardTitle className="display-font text-2xl">{perk.title}</CardTitle>
                      <CardDescription>{perk.text}</CardDescription>
                    </CardHeader>
                  </Card>
                )
              })}
            </section>

            <GiftCardCodes
              cards={data.giftCards.map((card) => ({
                id: card.id,
                code: card.code,
                balanceCents: card.balance_cents,
                originalCents: card.original_balance_cents,
                status: card.status,
                createdAt: card.created_at,
                redeemedAt: card.redeemed_at
              }))}
            />

            <div className="grid gap-6 xl:grid-cols-2">
              <AllPurchases orders={data.orders} />
              <AllRewards rewards={data.rewards} />
            </div>
          </section>

          <aside className="space-y-6">
            <AccountEconomyCard />

            <Card className="minecraft-card">
              <CardHeader>
                <CardTitle className="display-font text-3xl">Your Streak</CardTitle>
                <CardDescription>Vote each day to help RealFiction grow.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3">
                  <StatTile label="Current" value={data.voteStreak?.current_streak ?? 0} />
                  <StatTile label="Best" value={data.voteStreak?.longest_streak ?? 0} />
                  <StatTile label="This month" value={data.voteStreak?.monthly_votes ?? 0} />
                  <StatTile label="All votes" value={data.voteStreak?.total_votes ?? 0} />
                </div>
                <p className="mt-4 text-sm text-muted-foreground">
                  Last vote: {formatDate(data.voteStreak?.last_vote_at ?? null)}
                </p>
              </CardContent>
            </Card>

            <Card className="minecraft-card">
              <CardHeader>
                <CardTitle className="display-font text-3xl">Voting Links</CardTitle>
                <CardDescription>Pick a site, vote, and keep your streak alive.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2">
                {voteSites.map((site) => (
                  <Button key={site.name} asChild className="justify-between" variant="outline">
                    <Link href={site.href}>
                      {site.name}
                      <CalendarDays className="h-4 w-4" />
                    </Link>
                  </Button>
                ))}
              </CardContent>
            </Card>

            <Card className="minecraft-card">
              <CardHeader>
                <CardTitle className="display-font text-3xl">Account Snapshot</CardTitle>
                <CardDescription>No pay-to-win. Just cosmetics, style, and cozy extras.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2.5 text-sm text-muted-foreground">
                <SnapshotLine icon={SteveHeadIcon} label="Minecraft" value={verifiedLink?.minecraft_username ?? "Not linked yet"} />
                <SnapshotLine icon={NetherStarIcon} label="Perks owned" value={`${ownedCount} of ${perkCards.length}`} />
                <SnapshotLine icon={GrassBlockIcon} label="Main server" value="realfiction.live" />
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </main>
  )
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-amber-200/14 bg-black/24 p-4">
      <div className="font-mono text-3xl font-semibold text-amber-100">{value}</div>
      <div className="mt-1 text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
    </div>
  )
}

function SnapshotLine({
  icon: Icon,
  label,
  value
}: {
  icon: ComponentType<{ className?: string; size?: number }>
  label: string
  value: string
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/[0.035] px-3 py-2.5">
      <span className="flex shrink-0 items-center gap-2.5 font-medium text-slate-200">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center">
          <Icon className="h-4 w-4" />
        </span>
        {label}
      </span>
      <span className="min-w-0 truncate text-right text-slate-300">{value}</span>
    </div>
  )
}

function AllPurchases({ orders }: { orders: OrderRow[] }) {
  return (
    <Card className="minecraft-card">
      <CardHeader>
        <CardTitle className="display-font text-3xl">All Purchases</CardTitle>
        <CardDescription>Thanks for supporting RealFiction.</CardDescription>
      </CardHeader>
      <CardContent>
        {orders.length ? (
          <div className="max-h-[24rem] space-y-3 overflow-y-auto pr-1">
            {orders.map((order) => {
              const firstItem = order.order_items?.[0]
              const itemName = firstItem?.product_snapshot?.name ?? "Store item"
              const moreItems = Math.max((order.order_items?.length ?? 1) - 1, 0)
              const giftedTo = order.gifted_to_minecraft_username

              return (
                <div key={order.id} className="rounded-lg border border-white/10 bg-black/24 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-white">
                        {itemName}
                        {moreItems ? ` + ${moreItems} more` : ""}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">{formatDate(order.created_at)}</p>
                      {giftedTo ? (
                        <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-amber-100">
                          <Gift className="h-3.5 w-3.5" />
                          Gifted to: <span className="font-semibold">{giftedTo}</span>
                        </p>
                      ) : null}
                    </div>
                    <OrderStatusBadge status={order.status} />
                  </div>
                  {order.store_credit_applied_cents && order.store_credit_applied_cents > 0 ? (
                    <div className="mt-3 space-y-0.5 text-sm">
                      <p className="text-emerald-200">
                        Store credit applied: -{formatMoney(order.store_credit_applied_cents, order.currency)}
                      </p>
                      <p className="font-semibold text-amber-100">
                        Paid today:{" "}
                        {formatMoney(
                          order.payment_due_cents ?? Math.max(0, order.total_cents - order.store_credit_applied_cents),
                          order.currency
                        )}
                      </p>
                    </div>
                  ) : (
                    <p className="mt-3 text-sm font-semibold text-amber-100">
                      {formatMoney(order.total_cents, order.currency)}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <EmptyState icon={Gift} title="No purchases yet" text="Cosmetics and supporter perks will show here." />
        )}
      </CardContent>
    </Card>
  )
}

function AllRewards({ rewards }: { rewards: RewardRow[] }) {
  return (
    <Card className="minecraft-card">
      <CardHeader>
        <CardTitle className="display-font text-3xl">All Rewards</CardTitle>
        <CardDescription>Rewards from voting and the store appear here.</CardDescription>
      </CardHeader>
      <CardContent>
        {rewards.length ? (
          <div className="max-h-[24rem] space-y-3 overflow-y-auto pr-1">
            {rewards.map((reward) => (
              <div key={reward.id} className="rounded-lg border border-white/10 bg-black/24 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-white">{rewardTitle(reward)}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {rewardDetail(reward)} · {formatDate(reward.created_at)}
                    </p>
                  </div>
                  <RewardStatusBadge status={reward.status} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={Clock} title="No rewards yet" text="Vote or visit the store to start earning rewards." />
        )}
      </CardContent>
    </Card>
  )
}

function EmptyState({
  icon: Icon,
  title,
  text
}: {
  icon: typeof Gift
  title: string
  text: string
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.035] p-5 text-center">
      <Icon className="mx-auto h-8 w-8 text-amber-200" />
      <p className="mt-3 font-semibold text-white">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{text}</p>
    </div>
  )
}
