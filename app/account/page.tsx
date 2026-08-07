import { activeEntitlementSlugs } from "@/lib/store/access-view"
import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"

import { ArrowUpRight, Gift } from "lucide-react"

import { AccountAuthCard } from "@/components/account-auth-card"
import { AccountEconomyCard } from "@/components/account-economy-card"
import { AccountLinkCard } from "@/components/account-link-card"
import { AccountSignOutButton } from "@/components/account-sign-out-button"
import { GiftCardCodes } from "@/components/gift-card-codes"
import { BoneIcon, CheckIcon, ClockIcon, CompassIcon, DyeIcon, ElytraIcon, EmeraldIcon, FireworkRocketIcon, GearIcon, NetherStarIcon, WarningIcon } from "@/components/minecraft-icons"
import { Badge } from "@/components/ui/badge"

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { STORE_BANNER_HEIGHT, STORE_BANNER_WIDTH, voteSites } from "@/lib/data"
import { PurchaseRowCard, type PurchaseRow } from "@/components/account/purchase-history"
import { createSupabaseServerClient, getAuthenticatedUser } from "@/lib/supabase/server"
import { callServiceRoleRpc } from "@/lib/supabase/service-role-rest"

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

type OrderRow = PurchaseRow

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
  /** Coarse refund/dispute state per gift card. Empty when there is none. */
  giftCardStates: Record<string, string>
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
  // Legacy term SKUs were <base>-1m/-3m/-6m/-12m. The permanent SKUs that
  // replaced them are <base>-permanent, and the RealFiction+ pass is
  // <base>-30d. All collapse to the same base so a perk lights up whichever
  // generation of the product the customer actually owns.
  return slug.replace(/-(1m|3m|6m|12m|permanent|30d)$/, "")
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

/**
 * Refund and dispute state for the signed-in purchaser's own cards.
 *
 * Goes through the service role because `gift_card_refunds` is deliberately
 * unreadable by `authenticated` — the RPC projects it down to one coarse word
 * per card and nothing else. Best-effort: a missing migration or a transient
 * failure hides the badges rather than breaking the account page.
 */
async function purchaserGiftCardStates(): Promise<Record<string, string>> {
  const user = await getAuthenticatedUser().catch(() => null)
  if (!user) {
    return {}
  }

  const { data, error } = await callServiceRoleRpc<{ gift_card_id: string; state: string | null }[]>(
    "purchaser_gift_card_states",
    { p_user_id: user.id }
  )

  if (error || !Array.isArray(data)) {
    return {}
  }

  return Object.fromEntries(
    data.filter((row) => row.state).map((row) => [row.gift_card_id, row.state as string])
  )
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
        .select("id,status,total_cents,currency,created_at,paid_at,gifted_to_minecraft_username,store_credit_applied_cents,payment_due_cents,subtotal_cents,discount_cents,order_items(quantity,product_snapshot)")
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
      giftCardStates: await purchaserGiftCardStates(),
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
      giftCardStates: {},
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
  // CURRENT ownership, not historical. `activeEntitlementSlugs` is the same
  // rule the storefront uses, which is why the store already said these were
  // expired while this page said Owned: this line used to map EVERY entitlement
  // row, so a one-month grant from May counted as owned forever.
  //
  // The rows themselves are untouched — they are the record of a real purchase
  // and still appear under All Purchases.
  const currentSlugs = activeEntitlementSlugs(data.entitlements)
  const ownedSlugs = new Set([...currentSlugs].map((slug) => baseSlug(slug)))

  // Everything ever held, for telling "expired" apart from "never bought".
  const everSlugs = new Set(data.entitlements.map((row) => baseSlug(entitlementSlug(row))))

  const ownedCount = perkCards.filter((perk) => perk.slugs.some((slug) => ownedSlugs.has(slug))).length

  return (
    <main className="pb-12 md:pb-16">
      <div className="mx-auto max-w-6xl py-6 md:py-10">
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <section className="space-y-6">
            {/* The account's identity is the linked Minecraft account, not a
                greeting. "Welcome back" occupied a full panel at 6xl to say
                nothing, and pushed the link state — the thing this page is
                actually about — below it. */}
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
              <h1 className="display-font text-3xl font-semibold leading-tight text-white md:text-4xl">
                Your account
              </h1>
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
                <Link href="/vote" className="text-amber-100 underline underline-offset-4">
                  Vote for rewards
                </Link>
                <Link href="/store" className="text-amber-100 underline underline-offset-4">
                  Visit store
                </Link>
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

            {/* Perks as a compact list. Six banner cards made the state — the
                only thing a returning player checks — the smallest element on
                each card, and cost roughly a screen of height. Active first,
                so "what do I have right now" is the top of the list. */}
            <section aria-labelledby="perks-heading">
              <div className="flex items-baseline justify-between gap-3 border-b border-amber-200/15 pb-1.5">
                <h2
                  id="perks-heading"
                  className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground"
                >
                  Perks
                </h2>
                <span className="font-mono text-xs text-muted-foreground tabular-nums">
                  {ownedCount}/{perkCards.length}
                </span>
              </div>

              <ul className="mt-1">
                {[...perkCards]
                  .map((perk) => {
                    const unlocked = perk.slugs.some((slug) => ownedSlugs.has(slug))
                    // Held once, but not now. Worth distinguishing from
                    // "Locked": a lapsed supporter should see that their perk
                    // ended, not a card implying they never bought it.
                    const lapsed = !unlocked && perk.slugs.some((slug) => everSlugs.has(slug))
                    return { perk, unlocked, lapsed }
                  })
                  .sort((a, b) => Number(b.unlocked) - Number(a.unlocked))
                  .map(({ perk, unlocked, lapsed }) => {
                    return (
                      <li
                        key={perk.key}
                        className="flex items-center gap-3 border-b border-white/[0.06] py-2.5"
                      >
                        {/* The SAME store artwork, as a thumbnail. Recognisable
                            art scans faster than a generic icon, and reusing the
                            store's file keeps account and store visually one
                            product — an invariant lib/store-banners.test.ts
                            enforces. */}
                        <Image
                          alt=""
                          aria-hidden
                          src={`/images/store/${perk.slugs[0]}.png`}
                          width={STORE_BANNER_WIDTH}
                          height={STORE_BANNER_HEIGHT}
                          className={`h-8 w-14 shrink-0 border border-white/10 object-cover ${
                            unlocked ? "" : "opacity-35 grayscale"
                          }`}
                        />
                        <span className="min-w-0 flex-1">
                          <span
                            className={`block truncate text-sm font-semibold ${
                              unlocked ? "text-white" : "text-muted-foreground"
                            }`}
                          >
                            {perk.title}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {perk.text}
                          </span>
                        </span>
                        <Badge variant={unlocked ? "success" : lapsed ? "warning" : "outline"}>
                          {unlocked ? "Owned" : lapsed ? "Expired" : "Locked"}
                        </Badge>
                      </li>
                    )
                  })}
              </ul>
            </section>

            <GiftCardCodes
              cards={data.giftCards.map((card) => ({
                id: card.id,
                code: card.code,
                balanceCents: card.balance_cents,
                originalCents: card.original_balance_cents,
                status: card.status,
                createdAt: card.created_at,
                redeemedAt: card.redeemed_at,
                refundState: data.giftCardStates[card.id] ?? null
              }))}
            />

            {/* Everything above is CURRENT state; everything below is history.
                The rule is the separation — previously both sat in identical
                panels, so a two-year-old order looked as live as an active
                perk. */}
            <div className="grid gap-8 border-t border-white/10 pt-6 xl:grid-cols-2 xl:gap-10">
              <AllPurchases orders={data.orders} />
              <AllRewards rewards={data.rewards} />
            </div>
          </section>

          <aside className="space-y-8">
            <AccountEconomyCard />

            {/* Streak: four numbers, not four bordered tiles inside a card.
                Vote data is real but subordinate to account identity, so it
                reads as a compact stat row rather than a headline panel. */}
            <section aria-labelledby="streak-heading">
              <h2
                id="streak-heading"
                className="border-b border-white/10 pb-1.5 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground"
              >
                Vote streak
              </h2>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
                {[
                  { label: "Current", value: data.voteStreak?.current_streak ?? 0 },
                  { label: "Best", value: data.voteStreak?.longest_streak ?? 0 },
                  { label: "This month", value: data.voteStreak?.monthly_votes ?? 0 },
                  { label: "All time", value: data.voteStreak?.total_votes ?? 0 }
                ].map((stat) => (
                  <div key={stat.label}>
                    <dd className="font-mono text-2xl font-semibold leading-none text-amber-100 tabular-nums">
                      {stat.value}
                    </dd>
                    <dt className="mt-1 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                      {stat.label}
                    </dt>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-xs text-muted-foreground">
                Last vote: {formatDate(data.voteStreak?.last_vote_at ?? null)}
              </p>
            </section>

            {/* Ten outline buttons became ten rows. The vote page is the place
                that shows cooldowns; this is a shortcut list, so it stays quiet. */}
            <section aria-labelledby="vote-links-heading">
              <div className="flex items-baseline justify-between gap-3 border-b border-white/10 pb-1.5">
                <h2
                  id="vote-links-heading"
                  className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground"
                >
                  Vote sites
                </h2>
                <Link href="/vote" className="text-xs text-amber-100 underline underline-offset-4">
                  Cooldowns
                </Link>
              </div>
              <ul className="mt-1">
                {voteSites.map((site) => (
                  <li key={site.name} className="border-b border-white/[0.06]">
                    <a
                      href={site.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-center justify-between gap-3 py-2 text-sm text-slate-200 transition hover:text-amber-100"
                    >
                      <span className="min-w-0 truncate">{site.name}</span>
                      <ArrowUpRight
                        className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-amber-100"
                        aria-hidden
                      />
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        </div>
      </div>
    </main>
  )
}

/**
 * Purchase history as a feed.
 *
 * Was a card titled "All Purchases" with the subtitle "Thanks for supporting
 * RealFiction" — a thank-you occupying the line where a reader looks for what
 * the section contains. The rows themselves are unchanged: `PurchaseRowCard`
 * still renders every order exactly as before.
 */
function AllPurchases({ orders }: { orders: OrderRow[] }) {
  return (
    <section aria-labelledby="purchases-heading" className="min-w-0">
      <div className="flex items-baseline justify-between gap-3 border-b border-white/10 pb-1.5">
        <h2
          id="purchases-heading"
          className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground"
        >
          Purchases
        </h2>
        {orders.length ? (
          <span className="font-mono text-xs text-muted-foreground tabular-nums">{orders.length}</span>
        ) : null}
      </div>
      {orders.length ? (
        <div className="mt-3 max-h-[24rem] space-y-3 overflow-y-auto pr-1">
          {orders.map((order) => (
            <PurchaseRowCard key={order.id} order={order} />
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          No purchases yet. Cosmetics and supporter perks will show here.
        </p>
      )}
    </section>
  )
}

/** Reward history as a feed. Same rows, hairlines instead of boxes. */
function AllRewards({ rewards }: { rewards: RewardRow[] }) {
  return (
    <section aria-labelledby="rewards-heading" className="min-w-0">
      <div className="flex items-baseline justify-between gap-3 border-b border-white/10 pb-1.5">
        <h2
          id="rewards-heading"
          className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground"
        >
          Rewards
        </h2>
        {rewards.length ? (
          <span className="font-mono text-xs text-muted-foreground tabular-nums">{rewards.length}</span>
        ) : null}
      </div>
      {rewards.length ? (
        <ul className="mt-1 max-h-[24rem] overflow-y-auto pr-1">
          {rewards.map((reward) => (
            <li
              key={reward.id}
              className="flex items-start justify-between gap-3 border-b border-white/[0.06] py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{rewardTitle(reward)}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {rewardDetail(reward)} · {formatDate(reward.created_at)}
                </p>
              </div>
              <RewardStatusBadge status={reward.status} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          No rewards yet. Vote or visit the store to start earning rewards.
        </p>
      )}
    </section>
  )
}
