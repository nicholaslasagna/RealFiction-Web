import {
  BadgeCheck,
  Boxes,
  Castle,
  Crown,
  Gift,
  MapPinned,
  Medal,
  MessageCircle,
  Palette,
  PartyPopper,
  Pickaxe,
  Plane,
  ShieldCheck,
  Sparkles,
  Swords,
  Trophy,
  UserRound,
  WandSparkles,
  Zap
} from "lucide-react"

export type ProductCategory =
  | "supporter"
  | "cosmetics"
  | "pets"
  | "particles"
  | "identity"
  | "lobby"
  | "gift-cards"

export type StoreProduct = {
  id: string
  name: string
  category: ProductCategory
  priceCents: number
  summary: string
  details: string[]
  fulfillment: "permanent" | "subscription" | "consumable"
  durationDays?: number
  featured?: boolean
  accent: string
}

export const navItems = [
  { href: "/", label: "Home" },
  { href: "/store", label: "Store" },
  { href: "/vote", label: "Vote" },
  { href: "/account", label: "Account" },
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
    image: "/images/parkour.png",
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
    name: "LobbyGames",
    href: "/store",
    image: "/images/hero1.png",
    icon: Zap,
    summary: "Parkour, quick challenges, cosmetics, pets, particles, and social spaces.",
    signal: "Social hub"
  }
]

export const storeProducts: StoreProduct[] = [
  {
    id: "realvip-monthly",
    name: "RealVIP",
    category: "supporter",
    priceCents: 699,
    summary: "Monthly supporter rank with profile style, chat flair, and lobby cosmetics.",
    details: ["No gameplay advantage", "Monthly supporter badge", "Cosmetic permissions", "Priority support queue"],
    fulfillment: "subscription",
    durationDays: 30,
    featured: true,
    accent: "cyan"
  },
  {
    id: "real-supporter",
    name: "RealSupporter",
    category: "supporter",
    priceCents: 2499,
    summary: "Permanent account supporter status for community members who want to back the network.",
    details: ["Permanent supporter profile frame", "Discord supporter sync", "Cosmetic-only perks", "Monthly cosmetic drop"],
    fulfillment: "permanent",
    featured: true,
    accent: "amber"
  },
  {
    id: "realpets-pack",
    name: "RealPets Pack",
    category: "pets",
    priceCents: 999,
    summary: "Unlock a rotating pet collection for hubs, lobbies, and social spaces.",
    details: ["Lobby-only pets", "Nameable pet profile", "Seasonal skins", "No combat effects"],
    fulfillment: "permanent",
    accent: "emerald"
  },
  {
    id: "particle-vault",
    name: "Particle Vault",
    category: "particles",
    priceCents: 799,
    summary: "Cinematic trails, celebration effects, and lobby visual effects.",
    details: ["Lobby and cosmetic-safe effects", "Toggleable presets", "Profile showcase support", "Queue-based delivery"],
    fulfillment: "permanent",
    accent: "violet"
  },
  {
    id: "username-colors",
    name: "Username Colors",
    category: "identity",
    priceCents: 499,
    summary: "Curated chat colors and nameplate identity styles powered by LuckPerms.",
    details: ["Approved palette", "Works with prefixes", "No staff impersonation colors", "Instant website sync"],
    fulfillment: "permanent",
    accent: "rose"
  },
  {
    id: "lobby-flight",
    name: "Lobby Flight",
    category: "lobby",
    priceCents: 599,
    summary: "Smooth lobby flight for hubs, spawn showcases, and event spaces.",
    details: ["Lobby-only convenience", "No survival or PvP impact", "Expires cleanly if timed", "Folia-safe fulfillment"],
    fulfillment: "permanent",
    accent: "sky"
  },
  {
    id: "cosmetic-atelier",
    name: "Cosmetic Atelier",
    category: "cosmetics",
    priceCents: 1299,
    summary: "A curated bundle of profile effects, lobby entrances, particles, and badges.",
    details: ["Profile customization", "Lobby entrance effects", "Seasonal badge rotation", "Giftable"],
    fulfillment: "permanent",
    featured: true,
    accent: "blue"
  },
  {
    id: "gift-card-25",
    name: "$25 Gift Card",
    category: "gift-cards",
    priceCents: 2500,
    summary: "Send store credit for cosmetics, supporter ranks, and visual profile perks.",
    details: ["Redeemable account credit", "Fraud-checked redemption", "Balance tracking", "Gift-friendly checkout"],
    fulfillment: "consumable",
    accent: "amber"
  }
]

export const productCategories: Array<{
  id: ProductCategory | "all"
  label: string
  icon: typeof Sparkles
}> = [
  { id: "all", label: "All", icon: Sparkles },
  { id: "supporter", label: "Supporter", icon: Crown },
  { id: "cosmetics", label: "Cosmetics", icon: Palette },
  { id: "pets", label: "Pets", icon: UserRound },
  { id: "particles", label: "Particles", icon: WandSparkles },
  { id: "identity", label: "Identity", icon: MessageCircle },
  { id: "lobby", label: "Lobby", icon: Plane },
  { id: "gift-cards", label: "Gift Cards", icon: Gift }
]

export const voteSites = [
  {
    name: "MinecraftServers.org",
    href: "https://minecraftservers.org",
    reward: "Vote key + streak XP",
    cooldownHours: 24
  },
  {
    name: "PlanetMinecraft",
    href: "https://planetminecraft.com",
    reward: "Vote key + profile points",
    cooldownHours: 24
  },
  {
    name: "Minecraft-MP",
    href: "https://minecraft-mp.com",
    reward: "Vote key + daily progress",
    cooldownHours: 24
  },
  {
    name: "TopG",
    href: "https://topg.org",
    reward: "Vote key + streak shield",
    cooldownHours: 24
  },
  {
    name: "Minecraft Menu",
    href: "https://minecraft.menu",
    reward: "Vote key",
    cooldownHours: 24
  },
  {
    name: "Servers-Minecraft",
    href: "https://servers-minecraft.net",
    reward: "Vote key + monthly score",
    cooldownHours: 24
  },
  {
    name: "Minecraft.Buzz",
    href: "https://minecraft.buzz",
    reward: "Vote key",
    cooldownHours: 24
  },
  {
    name: "CurseForge",
    href: "https://www.curseforge.com/minecraft/servers",
    reward: "Vote key + cosmetic chance",
    cooldownHours: 24
  },
  {
    name: "mclist.io",
    href: "https://mclist.io",
    reward: "Vote key",
    cooldownHours: 24
  },
  {
    name: "MCSL",
    href: "https://minecraft-server-list.com",
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
    icon: MapPinned
  },
  {
    name: "RealFiction Map 2",
    url: "https://map2.realfiction.live",
    description: "Secondary world map and seasonal map spaces.",
    icon: Boxes
  },
  {
    name: "RealAnarchy Map",
    url: "https://map.realanarchy.live",
    description: "RealAnarchy world map and independent network surface.",
    icon: ShieldCheck
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
      "Do not scam through ambiguous trades, fake ranks, or off-platform payment promises.",
      "Chargebacks, payment fraud, and gift card abuse are investigated through audit logs.",
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
      "Linked Minecraft accounts can be reverified through the account dashboard.",
      "Suspicious purchases, gift redemptions, and voting patterns may be temporarily held."
    ]
  }
]

export const updates = [
  {
    version: "Platform 2.0",
    title: "RealFiction Platform Foundation",
    date: "2026-05-20",
    type: "Platform",
    summary:
      "New account, vote, store, and fulfillment architecture for a full custom RealFiction ecosystem.",
    tags: ["Next.js", "Supabase", "Cloudflare", "Store"]
  },
  {
    version: "Network Ops",
    title: "Fair Store Direction",
    date: "2026-05-20",
    type: "Store",
    summary:
      "RealFiction store products are cosmetics, supporter identity, visual effects, and lobby convenience only.",
    tags: ["No P2W", "Cosmetics", "Supporter"]
  },
  {
    version: "Voting",
    title: "Vote Progression System",
    date: "2026-05-20",
    type: "Community",
    summary:
      "Vote sites, streaks, monthly top voters, cooldowns, analytics, and claimable reward queues are planned in one flow.",
    tags: ["Voting", "Rewards", "Leaderboard"]
  }
]

export const architectureHighlights = [
  {
    title: "Cloudflare first",
    body: "Next.js App Router ships to Cloudflare Pages through OpenNext, with API routes running as Worker-compatible functions."
  },
  {
    title: "Supabase as the source of truth",
    body: "Auth, PostgreSQL, RLS, entitlements, orders, reward queues, vote history, gift cards, audit logs, and support tickets live in Supabase."
  },
  {
    title: "Plugin-delivered rewards",
    body: "RealCore polls signed reward queues, talks to LuckPerms, and delivers cosmetics or timed ranks safely for online and offline players."
  },
  {
    title: "No pay-to-win boundary",
    body: "Store schema and fulfillment types are constrained around cosmetics, identity, profile style, lobby convenience, and supporter status."
  }
]

export const accountPanels = [
  {
    title: "Minecraft Link",
    status: "Ready for verification",
    body: "Link a Java or Bedrock account through a one-time code and lock purchases to verified ownership."
  },
  {
    title: "Purchase History",
    status: "Webhook backed",
    body: "Stripe, PayPal, gift card, coupon, and refund events reconcile into immutable order records."
  },
  {
    title: "Owned Cosmetics",
    status: "Synced to server",
    body: "Permanent unlocks, supporter perks, lobby effects, particles, pets, and profile frames stay tied to account entitlements."
  },
  {
    title: "Security",
    status: "RLS enforced",
    body: "Auth sessions, device review, linked-account changes, support actions, and fulfillment events are audit logged."
  }
]

export const socials = [
  { label: "Discord", href: "https://discord.com/invite/JkPpmzn" },
  { label: "YouTube", href: "https://www.youtube.com/@RealFictionMC" },
  { label: "X", href: "https://x.com/RealFictionMC" },
  { label: "Instagram", href: "https://www.instagram.com/realfictionmc/" }
]

export const trustPillars = [
  { label: "Cosmetics only", icon: Sparkles },
  { label: "RLS everywhere", icon: ShieldCheck },
  { label: "Webhook verified", icon: BadgeCheck },
  { label: "Idempotent rewards", icon: Medal }
]
