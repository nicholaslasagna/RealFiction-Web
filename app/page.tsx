import Image from "next/image"
import Link from "next/link"

import { CopyServerButton } from "@/components/copy-server-button"
import { HomeAdventureGrid } from "@/components/home-adventure-grid"
import { HomeDiscordCard } from "@/components/home-discord-card"
import { HomeLiveMaps } from "@/components/home-live-maps"
import { HomeNetworkInNumbers } from "@/components/home-network-in-numbers"
import { HomePerksBand } from "@/components/home-perks-band"
import { HomeVoteStreak } from "@/components/home-vote-streak"
import { LivePlayerCount } from "@/components/live-player-count"

/* ============================================================
   Inline icons — match the mockup's minimal SVG glyphs
   ============================================================ */

function DiscordIcon({ width = 16, height = 16, className }: { width?: number; height?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width={width} height={height} className={className} aria-hidden>
      <path d="M19.7 5.3A18.3 18.3 0 0 0 15.2 4l-.3.6c1.6.4 3 1 4.2 1.8a13.8 13.8 0 0 0-13.8 0c1.2-.7 2.6-1.4 4.2-1.8L9.2 4a18.3 18.3 0 0 0-4.5 1.3C2.4 8.7 1.8 12.1 2.1 15.4a18.5 18.5 0 0 0 5.6 2.8c.5-.7.9-1.4 1.2-2.2-.7-.3-1.4-.7-2-1.1.2-.1.4-.3.5-.4a13.1 13.1 0 0 0 11.3 0c.2.1.3.3.5.4-.6.4-1.3.8-2 1.1.3.8.7 1.5 1.2 2.2a18.5 18.5 0 0 0 5.6-2.8c.4-3.8-.6-7.2-3.3-10.1ZM8.7 13.5c-1.1 0-2-1-2-2.2s.9-2.3 2-2.3 2 1 2 2.3-.9 2.2-2 2.2Zm6.6 0c-1.1 0-2-1-2-2.2s.9-2.3 2-2.3 2 1 2 2.3-.9 2.2-2 2.2Z" />
    </svg>
  )
}

/* ============================================================
   Mockup data — the exact content from sections.jsx
   ============================================================ */

/* Adventure data — each card opens a description modal instead of
   navigating away. `long` is the expanded copy shown in the modal. */
const ADVENTURES = [
  {
    name: "SMP",
    tag: "Community survival",
    bg: "/images/hero2.png",
    body: "Long-term survival with player economies, community builds, and fair progression.",
    long:
      "RealFiction SMP is our flagship long-term survival world. Build wherever you like, claim land, run shops, trade with the player economy, and join community projects without anyone ever buying their way to the top. Hostile mobs, full Vanilla+ progression, and seasonal events keep things alive."
  },
  {
    name: "Factions",
    tag: "Seasonal conflict",
    bg: "/images/hero1.png",
    body: "Territory, alliances, base defense, and seasonal competition without paid power.",
    long:
      "Form a faction, fight for territory, raid rivals, and defend your base across a fresh seasonal map. Every season starts on equal footing — no purchased kits, no pay-to-win gear, just smart base design, alliances, and grit."
  },
  {
    name: "Arcade",
    tag: "Quick play",
    bg: "/images/parkour.png",
    body: "Fast minigames, parkour challenges, quick matches, and rotating server events.",
    long:
      "Quick, snackable rounds — parkour courses, mini-games, weekly challenges, and rotating community events. Hop in for 5 minutes between SMP sessions or sink an evening into the leaderboards."
  },
  {
    name: "BedWars",
    tag: "Competitive arcade",
    bg: "/images/bedwars.png",
    body: "Fast team rounds, clean matchmaking, cosmetics, and tournament-ready stats.",
    long:
      "Classic BedWars with clean matchmaking and tournament-grade stats. Defend your bed, raid your enemies, and climb the rotation ladder. Solo, duos, and squads queues — cosmetics earned in-game or via the supporter store."
  },
  {
    name: "Murder Mystery",
    tag: "Party mode",
    bg: "/images/hero2.png",
    body: "Social deduction, lobby parties, clean progression, and profile-level rewards.",
    long:
      "Social deduction in a curated party-mode lobby. One murderer, one detective, a roomful of innocents, and a steady drip of profile-level rewards. Great for groups jumping between modes."
  },
  {
    name: "Tournaments",
    tag: "Live events",
    bg: "/images/tournaments.png",
    body: "Scheduled events, live brackets, rewards, and a fair competitive ruleset.",
    long:
      "Scheduled live events with public brackets and a fair competitive ruleset. Sign up for BedWars duos, parkour cups, faction wars, or themed seasonal showdowns. Prize pools are cosmetic + in-game economy — never advantages."
  }
]

// Each perk gets the same pixel-art Minecraft item used for its store
// category, so the homepage row reads like a row of inventory slots.
export default function HomePage() {
  return (
    <>
      {/* ─── HERO ──────────────────────────────────────────── */}
      <section className="hero">
        <div
          className="hero-bg"
          style={{ backgroundImage: "url(/images/hero1.png)" }}
          aria-hidden
        />
        <div className="hero-bg-overlay" aria-hidden />

        <div className="hero-content">
          <Image
            id="rf-logo"
            src="/images/rf.png"
            alt="RealFiction"
            width={420}
            height={420}
            priority
            unoptimized
          />

          <LivePlayerCount />

          <h1>Welcome to RealFiction</h1>
          <p className="ip">realfiction.live</p>
          <p className="ip2">Bedrock: bedrock.realfiction.live · Port 19132 (Default)</p>

          <div className="hero-actions">
            <CopyServerButton value="realfiction.live" label="Copy Java IP" />
            <a className="mc-button" href="https://discord.com/invite/JkPpmzn">
              <DiscordIcon /> Join Our Discord
            </a>
          </div>
        </div>
      </section>

      {/* ─── WHO WE ARE ───────────────────────────────────── */}
      <section className="who">
        <h3>Who We Are</h3>
        <p>
          Founded in late 2018,{" "}
          <span className="accent">RealFiction</span>
          {" "}is a fun, community-driven Minecraft network designed for players who value
          fair gameplay and a welcoming environment. We specialize in Survival and Factions,
          with plenty of other gamemodes to keep the adventure going. Our server is proudly
          anti pay-to-win, ensuring a level playing field for everyone — whether you&apos;re
          teaming up with friends or carving out your own path, RealFiction offers the perfect
          mix of creativity, challenge, and community spirit.
        </p>
      </section>

      {/* ─── LIVE NETWORK STATS (real data + Minecraft skins) ─ */}
      <HomeNetworkInNumbers />

      {/* ─── CHOOSE YOUR ADVENTURE — click opens a modal, no navigation ─ */}
      <section className="section-dark">
        <h3 className="section-title">Choose Your Adventure</h3>
        <p className="section-kicker">
          Jump into long-term survival, seasonal competition, quick arcade rounds, party modes,
          and community events built around fair play.
        </p>

        <HomeAdventureGrid adventures={ADVENTURES} />
      </section>

      {/* ─── SUPPORT — perks-band ─────────────────────────── */}
      <section className="section-deep">
        <h3 className="section-title">Back the server. Keep the game fair.</h3>
        <p className="section-kicker">
          RealFiction support stays focused on style, identity, lobby fun, and community perks.
          No paid kits, no bought power, no shortcut around the rules.
        </p>
        <HomePerksBand />
        <div style={{ textAlign: "center", marginTop: 40 }}>
          <Link className="mc-button mc-button--gold" href="/store">
            Visit the Store
          </Link>
        </div>
      </section>

      {/* ─── VOTE & EARN REWARDS (real per-user streak) ───── */}
      <HomeVoteStreak />

      {/* ─── LIVE MAPS — tabs + map frame (client component) ─ */}
      <HomeLiveMaps />

      {/* ─── COMMUNITY — real Discord member count, no fake feed ─ */}
      <HomeDiscordCard />

      {/* ─── FINAL CTA banner with bg image ───────────────── */}
      <section className="section-dark" style={{ padding: "10px 0 60px" }}>
        <div className="cta-banner">
          <div
            className="cta-bg"
            style={{ backgroundImage: "url(/images/hero2.png)" }}
            aria-hidden
          />
          <div className="cta-overlay" aria-hidden />
          <div className="cta-inner">
            <h2>
              A server built around players,
              <br />
              not purchases.
            </h2>
            <p>
              Explore, compete, vote, collect cosmetics, show off your profile, and stay close
              to the community that gives the network its shape.
            </p>
            <div
              style={{
                display: "flex",
                gap: 12,
                justifyContent: "center",
                flexWrap: "wrap"
              }}
            >
              <Link className="mc-button" href="/store">
                Browse Cosmetics
              </Link>
              <Link className="mc-button mc-button--ghost" href="/rules">
                Read the Rules
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
