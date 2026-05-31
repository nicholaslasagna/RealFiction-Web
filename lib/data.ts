import type { ComponentType } from "react"
import {
  BadgeCheck,
  Castle,
  Medal,
  Palette,
  PartyPopper,
  Pickaxe,
  ShieldCheck,
  Swords,
  Trophy,
  Zap
} from "lucide-react"

import {
  ArmorIcon,
  BoneIcon,
  ChestIcon,
  CraftingTableIcon,
  DyeIcon,
  ElytraIcon,
  FireworkRocketIcon,
  MapItemIcon,
  NetherStarIcon,
  ShieldIcon,
  SwordIcon
} from "@/components/minecraft-icons"

export type ProductCategory =
  | "supporter"
  | "cosmetics"
  | "pets"
  | "particles"
  | "identity"
  | "lobby"
  | "gift-cards"

export type DurationMonths = 1 | 3 | 6 | 12

export type SubscriptionTier = {
  slug: string
  months: DurationMonths
  priceCents: number
}

export type SubscriptionProduct = {
  id: string
  name: string
  category: ProductCategory
  summary: string
  details: string[]
  accent: string
  featured?: boolean
  tiers: SubscriptionTier[]
}

export type GiftCard = {
  id: string
  name: string
  category: ProductCategory
  priceCents: number
  summary: string
  details: string[]
  fulfillment: "consumable"
  featured?: boolean
  accent: string
  image: string
}

export const DURATION_LABEL: Record<DurationMonths, string> = {
  1: "1 month",
  3: "3 months",
  6: "6 months",
  12: "1 year"
}

// "Store" intentionally omitted from the centered nav — there's already a
// dedicated yellow Store CTA pinned to the right side of the header, and
// surfacing it twice was confusing.
export const navItems = [
  { href: "/", label: "Home" },
  { href: "/vote", label: "Vote" },
  { href: "/leaderboards", label: "Leaderboards" },
  { href: "/map", label: "Map" },
  { href: "/rules", label: "Rules" },
  { href: "/updates", label: "Updates" },
  { href: "/discord", label: "Discord" },
  { href: "/contact", label: "Contact" }
] as const

export const serverStats = [
  { label: "Network launch", value: "2018" },
  { label: "Core modes", value: "8" },
  { label: "Gameplay advantages sold", value: "0" },
  { label: "Java", value: "realfiction.live" },
  { label: "Bedrock", value: "19132" }
]

export const gamemodes = [
  {
    name: "SMP",
    href: "/map",
    image: "/images/creative.png",
    icon: Pickaxe,
    summary: "Long-term survival with player economies, community builds, and fair progression.",
    signal: "Community survival"
  },
  {
    name: "Factions",
    href: "/rules",
    image: "/images/hero2.png",
    icon: Swords,
    summary: "Territory, alliances, base defense, and seasonal competition without paid power.",
    signal: "Seasonal conflict"
  },
  {
    name: "Arcade",
    href: "/updates",
    image: "/images/parkour.png",
    icon: PartyPopper,
    summary: "Fast minigames, parkour challenges, quick matches, and rotating server events.",
    signal: "Quick play"
  },
  {
    name: "BedWars",
    href: "/updates",
    image: "/images/bedwars.png",
    icon: Castle,
    summary: "Fast team rounds, clean matchmaking goals, cosmetics, and tournament-ready stats.",
    signal: "Competitive arcade"
  },
  {
    name: "Murder Mystery",
    href: "/updates",
    image: "/images/hero1.png",
    icon: ShieldCheck,
    summary: "Social deduction, lobby parties, clean progression, and profile-level rewards.",
    signal: "Party mode"
  },
  {
    name: "Tournaments",
    href: "/vote",
    image: "/images/tournaments.png",
    icon: Trophy,
    summary: "Scheduled events, live brackets, rewards, and a fair competitive ruleset.",
    signal: "Live events"
  },
  {
    name: "Lobby Games",
    href: "/store",
    image: "/images/parkour.png",
    icon: Zap,
    summary: "Parkour, quick challenges, cosmetics, pets, particles, and social spaces.",
    signal: "Social hub"
  }
]

// Subscription products. Every non-gift product offers 1 / 3 / 6 / 12-month
// tiers with built-in discounts on the longer terms. Each tier is its own
// server-authoritative product slug (priced + duration-bound in the database).
export const storeProducts: SubscriptionProduct[] = [
  {
    id: "realvip",
    name: "RealVIP",
    category: "supporter",
    summary: "Supporter rank with profile style, chat flair, and lobby cosmetics.",
    details: ["No gameplay advantage", "Supporter badge + chat flair", "Lobby cosmetic perks", "Helpful support access"],
    accent: "cyan",
    featured: true,
    tiers: [
      { slug: "realvip-1m", months: 1, priceCents: 499 },
      { slug: "realvip-3m", months: 3, priceCents: 1299 },
      { slug: "realvip-6m", months: 6, priceCents: 2399 },
      { slug: "realvip-12m", months: 12, priceCents: 3999 }
    ]
  },
  {
    id: "real-supporter",
    name: "RealSupporter",
    category: "supporter",
    summary: "Top supporter status for members who want to back the network in style.",
    details: ["Supporter profile frame", "Discord supporter sync", "Cosmetic-only perks", "Monthly cosmetic drop"],
    accent: "amber",
    featured: true,
    tiers: [
      { slug: "real-supporter-1m", months: 1, priceCents: 999 },
      { slug: "real-supporter-3m", months: 3, priceCents: 2699 },
      { slug: "real-supporter-6m", months: 6, priceCents: 4799 },
      { slug: "real-supporter-12m", months: 12, priceCents: 7999 }
    ]
  },
  {
    id: "realpets",
    name: "RealPets Pack",
    category: "pets",
    summary: "A rotating pet collection for hubs, lobbies, and social spaces.",
    details: ["Lobby-only pets", "Nameable pet profile", "Seasonal skins", "No combat effects"],
    accent: "emerald",
    tiers: [
      { slug: "realpets-1m", months: 1, priceCents: 299 },
      { slug: "realpets-3m", months: 3, priceCents: 799 },
      { slug: "realpets-6m", months: 6, priceCents: 1399 },
      { slug: "realpets-12m", months: 12, priceCents: 2399 }
    ]
  },
  {
    id: "particle-vault",
    name: "Particle Vault",
    category: "particles",
    summary: "Cinematic trails, celebration effects, and lobby visual effects.",
    details: ["Lobby and cosmetic-safe effects", "Toggleable presets", "Profile showcase support", "Delivered to your account"],
    accent: "violet",
    tiers: [
      { slug: "particle-vault-1m", months: 1, priceCents: 349 },
      { slug: "particle-vault-3m", months: 3, priceCents: 899 },
      { slug: "particle-vault-6m", months: 6, priceCents: 1699 },
      { slug: "particle-vault-12m", months: 12, priceCents: 2799 }
    ]
  },
  {
    id: "username-colors",
    name: "Username Colors",
    category: "identity",
    summary: "Curated chat colors and nameplate identity styles for your in-game look.",
    details: ["Approved palette", "Works with prefixes", "No staff impersonation colors", "Works with your profile"],
    accent: "rose",
    tiers: [
      { slug: "username-colors-1m", months: 1, priceCents: 199 },
      { slug: "username-colors-3m", months: 3, priceCents: 499 },
      { slug: "username-colors-6m", months: 6, priceCents: 899 },
      { slug: "username-colors-12m", months: 12, priceCents: 1599 }
    ]
  },
  {
    id: "lobby-flight",
    name: "Lobby Flight",
    category: "lobby",
    summary: "Smooth lobby flight for hubs, spawn showcases, and event spaces.",
    details: ["Lobby-only convenience", "No survival or PvP impact", "Easy to turn on or off", "Made for hub areas"],
    accent: "sky",
    tiers: [
      { slug: "lobby-flight-1m", months: 1, priceCents: 249 },
      { slug: "lobby-flight-3m", months: 3, priceCents: 649 },
      { slug: "lobby-flight-6m", months: 6, priceCents: 1199 },
      { slug: "lobby-flight-12m", months: 12, priceCents: 1999 }
    ]
  },
  {
    id: "cosmetic-atelier",
    name: "Cosmetic Atelier",
    category: "cosmetics",
    summary: "A curated bundle of profile effects, lobby entrances, particles, and badges.",
    details: ["Profile customization", "Lobby entrance effects", "Seasonal badge rotation", "Giftable"],
    accent: "blue",
    featured: true,
    tiers: [
      { slug: "cosmetic-atelier-1m", months: 1, priceCents: 699 },
      { slug: "cosmetic-atelier-3m", months: 3, priceCents: 1899 },
      { slug: "cosmetic-atelier-6m", months: 6, priceCents: 3399 },
      { slug: "cosmetic-atelier-12m", months: 12, priceCents: 5599 }
    ]
  }
]

export const giftCards: GiftCard[] = [
  {
    id: "gift-card-5",
    name: "$5 Gift Card",
    category: "gift-cards",
    priceCents: 500,
    summary: "A small treat of store credit for cosmetics and profile perks.",
    details: ["Store credit for RealFiction", "Nice little gift", "Easy to redeem", "Spend it on anything cosmetic"],
    fulfillment: "consumable",
    accent: "amber",
    image: "/images/giftcard-5.png"
  },
  {
    id: "gift-card-10",
    name: "$10 Gift Card",
    category: "gift-cards",
    priceCents: 1000,
    summary: "A little something to spend on cosmetics, ranks, and profile perks.",
    details: ["Store credit for RealFiction", "Great small gift", "Easy to redeem", "Spend it on anything cosmetic"],
    fulfillment: "consumable",
    accent: "amber",
    image: "/images/giftcard-10.png"
  },
  {
    id: "gift-card-15",
    name: "$15 Gift Card",
    category: "gift-cards",
    priceCents: 1500,
    summary: "Store credit for cosmetics, ranks, and visual profile perks.",
    details: ["Store credit for RealFiction", "Easy gift size", "Easy to redeem", "Spend it on anything cosmetic"],
    fulfillment: "consumable",
    accent: "amber",
    image: "/images/giftcard-15.png"
  },
  {
    id: "gift-card-20",
    name: "$20 Gift Card",
    category: "gift-cards",
    priceCents: 2000,
    summary: "Give a friend store credit for cosmetics, ranks, and visual perks.",
    details: ["Store credit for RealFiction", "Perfect for a friend", "Easy to redeem", "Spend it on anything cosmetic"],
    fulfillment: "consumable",
    accent: "emerald",
    image: "/images/giftcard-20.png"
  },
  {
    id: "gift-card-25",
    name: "$25 Gift Card",
    category: "gift-cards",
    priceCents: 2500,
    summary: "Send store credit for cosmetics, supporter ranks, and visual profile perks.",
    details: ["Store credit for RealFiction", "A favorite gift size", "Easy to redeem", "Spend it on anything cosmetic"],
    fulfillment: "consumable",
    featured: true,
    accent: "emerald",
    image: "/images/giftcard-25.png"
  },
  {
    id: "gift-card-30",
    name: "$30 Gift Card",
    category: "gift-cards",
    priceCents: 3000,
    summary: "A generous amount of store credit for cosmetics and supporter ranks.",
    details: ["Store credit for RealFiction", "Generous gift", "Easy to redeem", "Spend it on anything cosmetic"],
    fulfillment: "consumable",
    accent: "emerald",
    image: "/images/giftcard-30.png"
  },
  {
    id: "gift-card-50",
    name: "$50 Gift Card",
    category: "gift-cards",
    priceCents: 5000,
    summary: "Plenty of store credit for cosmetics, ranks, and visual perks.",
    details: ["Store credit for RealFiction", "Great value gift", "Easy to redeem", "Spend it on anything cosmetic"],
    fulfillment: "consumable",
    accent: "violet",
    image: "/images/giftcard-50.png"
  },
  {
    id: "gift-card-75",
    name: "$75 Gift Card",
    category: "gift-cards",
    priceCents: 7500,
    summary: "A big stash of store credit for cosmetics and supporter ranks.",
    details: ["Store credit for RealFiction", "Big gift", "Easy to redeem", "Spend it on anything cosmetic"],
    fulfillment: "consumable",
    accent: "violet",
    image: "/images/giftcard-75.png"
  },
  {
    id: "gift-card-100",
    name: "$100 Gift Card",
    category: "gift-cards",
    priceCents: 10000,
    summary: "The biggest one — maximum store credit for the whole cosmetic shop.",
    details: ["Store credit for RealFiction", "Best value gift", "Easy to redeem", "Spend it on anything cosmetic"],
    fulfillment: "consumable",
    accent: "violet",
    image: "/images/giftcard-100.png"
  }
]

export const productCategories: Array<{
  id: ProductCategory | "all"
  label: string
  icon: ComponentType<{ className?: string; size?: number }>
}> = [
  { id: "all", label: "All", icon: CraftingTableIcon },
  { id: "supporter", label: "Supporter", icon: NetherStarIcon },
  { id: "cosmetics", label: "Cosmetics", icon: ArmorIcon },
  { id: "pets", label: "Pets", icon: BoneIcon },
  { id: "particles", label: "Particles", icon: FireworkRocketIcon },
  { id: "identity", label: "Identity", icon: DyeIcon },
  { id: "lobby", label: "Lobby", icon: ElytraIcon },
  { id: "gift-cards", label: "Gift Cards", icon: ChestIcon }
]

export const voteSites = [
  {
    name: "MinecraftServers.org",
    href: "https://minecraftservers.org/vote/558530",
    reward: "Vote key + streak XP",
    cooldownHours: 24
  },
  {
    name: "PlanetMinecraft.com",
    href: "https://www.planetminecraft.com/server/real-fiction/vote/",
    reward: "Vote key + profile points",
    cooldownHours: 24
  },
  {
    name: "Minecraft MP",
    href: "https://minecraft-mp.com/server/326865/vote/",
    reward: "Vote key + daily progress",
    cooldownHours: 24
  },
  {
    name: "TopG",
    href: "https://topg.org/minecraft-servers/server-669450",
    reward: "Vote key + streak shield",
    cooldownHours: 24
  },
  {
    name: "Minecraft Menu",
    href: "https://minecraft.menu/server-realfiction.4130/vote",
    reward: "Vote key",
    cooldownHours: 24
  },
  {
    name: "Servers-Minecraft",
    href: "https://servers-minecraft.net/server-realfiction.40945",
    reward: "Vote key + monthly score",
    cooldownHours: 24
  },
  {
    name: "Minecraft.Buzz",
    href: "https://minecraft.buzz/vote/12880",
    reward: "Vote key",
    cooldownHours: 24
  },
  {
    name: "CurseForge",
    href: "https://www.curseforge.com/servers/minecraft/game/realfiction/vote",
    reward: "Vote key + cosmetic chance",
    cooldownHours: 24
  },
  {
    name: "mclist.io",
    href: "https://mclist.io/server/65417-realfiction-live-realfiction-minigames-smp-f/vote",
    reward: "Vote key",
    cooldownHours: 24
  },
  {
    name: "MCSL",
    href: "https://minecraft-server-list.com/server/501080/vote/",
    reward: "Vote key + leaderboard score",
    cooldownHours: 24
  }
]

export const voteMilestones = [
  { votes: 5, reward: "Daily bonus key" },
  { votes: 15, reward: "Profile badge progress" },
  { votes: 30, reward: "Monthly cosmetic crate" },
  { votes: 75, reward: "Top voter showcase" }
]

export const mapEndpoints = [
  {
    name: "RealFiction Map",
    url: "https://map.realfiction.live",
    description: "Primary SMP world map, claims, settlements, and major community builds.",
    icon: MapItemIcon,
    embeddable: false
  },
  {
    name: "Factions",
    url: "https://map2.realfiction.live",
    description: "Factions world map, territory lines, and seasonal bases.",
    icon: SwordIcon,
    embeddable: false
  },
  {
    name: "RealAnarchy Map",
    url: "https://map.realanarchy.live",
    description: "RealAnarchy world map and independent network surface.",
    icon: ShieldIcon,
    embeddable: true
  }
]

export const rules = [
  {
    category: "Community",
    items: [
      "Respect other players, staff, builders, and event organizers.",
      "No harassment, hate speech, targeted abuse, or impersonation.",
      "Keep chat, usernames, skins, and profile customization appropriate for the community."
    ]
  },
  {
    category: "Fair Play",
    items: [
      "No hacked clients, automation, macros, x-ray, duping, or exploit abuse.",
      "Report bugs privately instead of using them for gain.",
      "No gameplay advantages are sold or tolerated through third-party side deals."
    ]
  },
  {
    category: "Economy",
    items: [
      "Do not scam through confusing trades, fake ranks, or outside payment promises.",
      "Chargebacks, payment fraud, and gift card abuse are reviewed by staff.",
      "Cosmetic purchases do not protect players from moderation action."
    ]
  },
  {
    category: "Factions",
    items: [
      "Base raiding must follow the active season ruleset.",
      "No alt abuse, illegal buffering, printer bypasses, or staff-side rule lawyering.",
      "Season rule updates are posted in updates and Discord before enforcement changes."
    ]
  },
  {
    category: "Builds",
    items: [
      "No griefing protected community spaces or staff-approved public builds.",
      "Claims, rollback requests, and disputes require clear evidence.",
      "Map art and public displays must follow community content standards."
    ]
  },
  {
    category: "Security",
    items: [
      "Never share account credentials, one-time verification codes, or payment session links.",
      "Linked Minecraft accounts can be checked again on your account page.",
      "Suspicious purchases, gift redemptions, and voting patterns may be temporarily held."
    ]
  }
]

/**
 * Patch-note style updates. Each entry has a slug so /updates/[slug]
 * can render the full breakdown. Section headings follow the standard
 * Added / Changed / Fixed / Notes flow so they read like a real
 * changelog instead of a marketing blurb.
 */
export type UpdateSection = {
  heading: string
  items: string[]
}

export type UpdateEntry = {
  slug: string
  version: string
  title: string
  date: string
  type: string
  summary: string
  tags: string[]
  body: string
  sections: UpdateSection[]
}

export const updates: UpdateEntry[] = [
  {
    slug: "site-2-0-foundation",
    version: "Site 2.0",
    title: "New RealFiction Site Foundation",
    date: "2026-05-20",
    type: "Website",
    summary:
      "A refreshed home for accounts, store checkout, voting, live maps, support, and server rewards.",
    tags: ["Website", "Accounts", "Store"],
    body:
      "Site 2.0 is the new foundation for everything outside the game itself. Accounts, store checkout, voting, live maps, support, leaderboards, and reward delivery now all live on a single fast Next.js platform. This release is mostly plumbing — the visible polish is just the start.",
    sections: [
      {
        heading: "Added",
        items: [
          "Account system with email sign-in, Minecraft account linking, and a per-player dashboard.",
          "Store checkout flow with Stripe, Apple Pay, Google Pay, and PayPal support.",
          "Live network leaderboards for total playtime and economy balance, with real Minecraft skin avatars.",
          "Live BlueMap embeds for SMP, Factions, and RealAnarchy.",
          "Public economy balance lookup tied to your linked Minecraft account.",
          "Gift card redemption form on the account page (back-end activation rolling out next)."
        ]
      },
      {
        heading: "Changed",
        items: [
          "Homepage rebuilt around the new mockup design — navy/gold palette, iconic green Minecraft button, full-bleed hero.",
          "Discord member counts on the homepage are now fetched live from Discord's public invite API instead of hardcoded.",
          "Vote streak card now reflects your real streak from the database when you're signed in."
        ]
      },
      {
        heading: "Fixed",
        items: [
          "Bedrock players (Geyser \".\"-prefixed usernames) now show a Steve head on the economy leaderboard instead of a blank avatar.",
          "Quantity +/- controls in the cart now render their icons correctly across sizes.",
          "Mobile hamburger menu now includes the Store CTA and locks body scroll when open."
        ]
      },
      {
        heading: "Notes",
        items: [
          "Gameplay is not affected by this release. All Minecraft worlds, balances, ranks, and ownerships are unchanged.",
          "If something looks off, ping #support on Discord — we're watching closely."
        ]
      }
    ]
  },
  {
    slug: "fair-store-direction",
    version: "Network Ops",
    title: "Fair Store Direction",
    date: "2026-05-20",
    type: "Store",
    summary:
      "RealFiction store products are cosmetics, supporter identity, visual effects, and lobby convenience only.",
    tags: ["No P2W", "Cosmetics", "Supporter"],
    body:
      "We're formalizing what the RealFiction store does and doesn't sell. The short version: cosmetics, supporter identity, visual effects, lobby-only convenience, and gift cards. Nothing that changes the outcome of gameplay.",
    sections: [
      {
        heading: "What the store sells",
        items: [
          "RealVIP and RealSupporter ranks (chat flair, profile frames, lobby-only perks).",
          "Pets, particles, username colors, and cosmetic bundles.",
          "Lobby flight — usable only in hubs, not in survival, factions, or PvP areas.",
          "Gift cards for store credit."
        ]
      },
      {
        heading: "What we don't sell",
        items: [
          "Gameplay advantage of any kind — no paid kits, gear, enchants, currency packs, or boosts.",
          "Anything that lets a buyer skip rules, gating, or progression on SMP, Factions, or Arcade modes.",
          "Server-side advantages tied to vote rewards (vote rewards stay cosmetic + minor progression)."
        ]
      },
      {
        heading: "Why",
        items: [
          "Fair play is the network's pitch. The moment buying becomes a shortcut to outcomes, the rest of the community loses.",
          "This policy is now enforced at the product level: every SKU in the store database is tagged as cosmetic / supporter / lobby / gift card."
        ]
      }
    ]
  },
  {
    slug: "vote-progression-system",
    version: "Voting",
    title: "Vote Progression System",
    date: "2026-05-20",
    type: "Community",
    summary:
      "Vote sites, streaks, monthly top voters, cooldowns, and reward progress are planned in one flow.",
    tags: ["Voting", "Rewards", "Leaderboard"],
    body:
      "Voting now flows through a single per-player progression record. Vote on any partner site, your streak ticks, your monthly count goes up, and milestone rewards queue automatically.",
    sections: [
      {
        heading: "Added",
        items: [
          "Per-player vote streak tracking (current streak, longest streak, monthly count, lifetime count).",
          "Monthly top voter board on /vote with end-of-month rewards.",
          "Milestone rewards at 5, 15, 30, and 75 monthly votes — each fires once per month.",
          "Per-site cooldown countdowns so you can tell when the next vote is ready."
        ]
      },
      {
        heading: "Vote sites supported",
        items: [
          "MinecraftServers.org · PlanetMinecraft.com · Minecraft-MP · TopG · Minecraft.Buzz",
          "CurseForge · mclist.io · MCSL · Minecraft Menu · Servers-Minecraft",
          "All sites credit the same streak and the same monthly count."
        ]
      },
      {
        heading: "Notes",
        items: [
          "You must link your Minecraft account on /account before votes count toward your record.",
          "Test usernames and PMC dummy votes are filtered out — they won't pad the leaderboard.",
          "Vote rewards stay cosmetic + minor progression to match the Fair Store Direction policy."
        ]
      }
    ]
  }
]

export const architectureHighlights = [
  {
    title: "Fast website",
    body: "RealFiction pages are built to feel quick, clean, and easy to use on desktop or mobile."
  },
  {
    title: "Player accounts",
    body: "Players can keep purchases, votes, linked Minecraft names, and support requests in one simple place."
  },
  {
    title: "Server rewards",
    body: "Cosmetics, supporter perks, and vote rewards are delivered to the right Minecraft account."
  },
  {
    title: "Fair store",
    body: "The shop stays focused on cosmetics, identity, profile style, lobby fun, and supporter status."
  }
]

export const accountPanels = [
  {
    title: "Minecraft Link",
    status: "Ready for verification",
    body: "Link a Java or Bedrock account through a one-time code so rewards land on the right player."
  },
  {
    title: "Purchase History",
    status: "Receipt ready",
    body: "View store orders, supporter perks, refunds, gift cards, and checkout receipts."
  },
  {
    title: "Owned Cosmetics",
    status: "Synced to server",
    body: "Permanent unlocks, supporter perks, lobby effects, particles, pets, and profile frames stay tied to your account."
  },
  {
    title: "Security",
    status: "Protected",
    body: "Review sign-in state, linked-account changes, support requests, and account safety."
  }
]

export const socials = [
  { label: "Discord", href: "https://discord.com/invite/JkPpmzn" },
  { label: "YouTube", href: "https://www.youtube.com/@RealFictionMC" },
  { label: "X", href: "https://x.com/RealFictionMC" },
  { label: "Instagram", href: "https://www.instagram.com/realfictionmc/" }
]

export const trustPillars = [
  { label: "Cosmetics only", icon: Palette },
  { label: "Secure checkout", icon: ShieldCheck },
  { label: "Verified rewards", icon: BadgeCheck },
  { label: "Fair play", icon: Medal }
]
