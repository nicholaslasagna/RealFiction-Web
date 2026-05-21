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
  image?: string
}

export const navItems = [
  { href: "/", label: "Home" },
  { href: "/store", label: "Store" },
  { href: "/vote", label: "Vote" },
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

export const storeProducts: StoreProduct[] = [
  {
    id: "realvip-monthly",
    name: "RealVIP",
    category: "supporter",
    priceCents: 699,
    summary: "Monthly supporter rank with profile style, chat flair, and lobby cosmetics.",
    details: ["No gameplay advantage", "Monthly supporter badge", "Cosmetic perks", "Helpful support access"],
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
    details: ["Lobby and cosmetic-safe effects", "Toggleable presets", "Profile showcase support", "Delivered to your account"],
    fulfillment: "permanent",
    accent: "violet"
  },
  {
    id: "username-colors",
    name: "Username Colors",
    category: "identity",
    priceCents: 499,
    summary: "Curated chat colors and nameplate identity styles for your in-game look.",
    details: ["Approved palette", "Works with prefixes", "No staff impersonation colors", "Works with your profile"],
    fulfillment: "permanent",
    accent: "rose"
  },
  {
    id: "lobby-flight",
    name: "Lobby Flight",
    category: "lobby",
    priceCents: 599,
    summary: "Smooth lobby flight for hubs, spawn showcases, and event spaces.",
    details: ["Lobby-only convenience", "No survival or PvP impact", "Easy to turn on or off", "Made for hub areas"],
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
  icon: typeof Boxes
}> = [
  { id: "all", label: "All", icon: Boxes },
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
    icon: MapPinned,
    embeddable: false
  },
  {
    name: "Factions",
    url: "https://map2.realfiction.live",
    description: "Factions world map, territory lines, and seasonal bases.",
    icon: Swords,
    embeddable: false
  },
  {
    name: "RealAnarchy Map",
    url: "https://map.realanarchy.live",
    description: "RealAnarchy world map and independent network surface.",
    icon: ShieldCheck,
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

export const updates = [
  {
    version: "Site 2.0",
    title: "New RealFiction Site Foundation",
    date: "2026-05-20",
    type: "Website",
    summary:
      "A refreshed home for accounts, store checkout, voting, live maps, support, and server rewards.",
    tags: ["Website", "Accounts", "Store"]
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
      "Vote sites, streaks, monthly top voters, cooldowns, and reward progress are planned in one flow.",
    tags: ["Voting", "Rewards", "Leaderboard"]
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
