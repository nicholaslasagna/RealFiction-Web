import Image from "next/image"
import Link from "next/link"

import { CopyServerButton } from "@/components/copy-server-button"
import { HomeLiveMaps } from "@/components/home-live-maps"
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

function GemIcon({ width = 18, height = 18 }: { width?: number; height?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={width}
      height={height}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 4h12l4 6-10 10L2 10l4-6z" />
      <path d="M2 10h20M9 4l3 6 3-6" />
    </svg>
  )
}

/* ============================================================
   Mockup data — the exact content from sections.jsx
   ============================================================ */

const ADVENTURES = [
  {
    name: "SMP",
    tag: "Community survival",
    bg: "/images/hero2.png",
    body: "Long-term survival with player economies, community builds, and fair progression.",
    href: "/map"
  },
  {
    name: "Factions",
    tag: "Seasonal conflict",
    bg: "/images/hero1.png",
    body: "Territory, alliances, base defense, and seasonal competition without paid power.",
    href: "/rules"
  },
  {
    name: "Arcade",
    tag: "Quick play",
    bg: "/images/parkour.png",
    body: "Fast minigames, parkour challenges, quick matches, and rotating server events.",
    href: "/updates"
  },
  {
    name: "BedWars",
    tag: "Competitive arcade",
    bg: "/images/bedwars.png",
    body: "Fast team rounds, clean matchmaking, cosmetics, and tournament-ready stats.",
    href: "/updates"
  },
  {
    name: "Murder Mystery",
    tag: "Party mode",
    bg: "/images/hero2.png",
    body: "Social deduction, lobby parties, clean progression, and profile-level rewards.",
    href: "/updates"
  },
  {
    name: "Tournaments",
    tag: "Live events",
    bg: "/images/tournaments.png",
    body: "Scheduled events, live brackets, rewards, and a fair competitive ruleset.",
    href: "/vote"
  }
]

const SUPPORT_PERKS = [
  "Cosmetics",
  "RealVIP",
  "Pets",
  "Particles",
  "Username colors",
  "Lobby flight",
  "Gift cards"
]

const DISCORD_FEED = [
  { c: "#announcements", n: "Season 6 launches Friday — patch notes inside.", who: "RF-Bot", t: "2m ago" },
  { c: "#tournaments", n: "BedWars duos sign-ups open · 32 slots.", who: "moderator-mim", t: "12m ago" },
  { c: "#screenshots", n: "Built a glass cathedral at -487, 64, 1203 👀", who: "ironhive", t: "1h ago" }
]

/* ============================================================
   Pixel head SVG (Top network player avatar in stat card 3)
   ============================================================ */

function PixelHead() {
  return (
    <svg
      width="56"
      height="56"
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      style={{
        background: "#1c2a40",
        border: "2px solid #0a0f18",
        padding: 2,
        boxShadow: "inset 0 2px 0 rgba(255,255,255,0.08), inset 0 -2px 0 rgba(0,0,0,0.3)"
      }}
    >
      <rect x="2" y="1" width="12" height="3" fill="#3a2316" />
      <rect x="1" y="2" width="14" height="2" fill="#3a2316" />
      <rect x="2" y="4" width="12" height="8" fill="#f1c08b" />
      <rect x="4" y="6" width="2" height="2" fill="#1c2a40" />
      <rect x="10" y="6" width="2" height="2" fill="#1c2a40" />
      <rect x="6" y="10" width="4" height="1" fill="#7a4023" />
      <rect x="2" y="12" width="12" height="3" fill="var(--mc-green)" />
    </svg>
  )
}

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
          Founded in late 2018, <span className="accent">RealFiction</span> is a fun,
          community-driven Minecraft network designed for players who value fair gameplay and
          a welcoming environment. We specialize in Survival and Factions, with plenty of
          other gamemodes to keep the adventure going. Our server is proudly anti pay-to-win,
          ensuring a level playing field for everyone — whether you&apos;re teaming up with
          friends or carving out your own path, RealFiction offers the perfect mix of
          creativity, challenge, and community spirit.
        </p>
      </section>

      {/* ─── LIVE NETWORK STATS ───────────────────────────── */}
      <section className="section-tinted">
        <h3 className="section-title">The whole network, in numbers.</h3>
        <p className="section-kicker">
          Totals roll up SMP, Factions, Anarchy, Arcade, and lobby playtime from across the
          RealFiction network.
        </p>

        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-eyebrow">Network playtime</div>
            <div className="stat-value">1 hr, 25 min</div>
            <div
              style={{
                marginTop: 16,
                height: 8,
                background: "rgba(255,255,255,0.06)",
                overflow: "hidden"
              }}
            >
              <div
                style={{
                  width: "62%",
                  height: "100%",
                  background: "linear-gradient(90deg, var(--mc-green), var(--gold))"
                }}
              />
            </div>
            <div className="stat-foot">Across SMP · Factions · Arcade · Anarchy · Lobby</div>
          </div>

          <div className="stat-card emerald">
            <div className="stat-eyebrow">Tracked players</div>
            <div className="stat-value" style={{ color: "var(--mc-green)" }}>
              4
            </div>
            <div style={{ marginTop: 18, display: "flex" }}>
              {["6c4326", "8e9092", "4d8a3a", "f2c66d"].map((c, i) => (
                <div
                  key={i}
                  style={{
                    width: 32,
                    height: 32,
                    background: `#${c}`,
                    border: "2px solid var(--navy-card)",
                    marginLeft: i ? -8 : 0,
                    boxShadow: "inset 0 -3px 0 rgba(0,0,0,0.25)",
                    imageRendering: "pixelated"
                  }}
                />
              ))}
            </div>
            <div className="stat-foot">Linked accounts seen on the network.</div>
          </div>

          <div className="stat-card navy">
            <div className="stat-eyebrow">Top network player</div>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 14 }}>
              <PixelHead />
              <div>
                <div
                  style={{
                    fontFamily: "rf-h1, sans-serif",
                    fontSize: 22,
                    color: "white",
                    lineHeight: 1.05
                  }}
                >
                  LittleNicholas
                </div>
                <div
                  className="f-mc"
                  style={{ color: "var(--gold)", fontSize: 15, marginTop: 4 }}
                >
                  52 min played
                </div>
              </div>
            </div>
            <div className="stat-foot">
              Full top 10 lives on the <Link href="/leaderboards">leaderboards page</Link>.
            </div>
          </div>
        </div>
      </section>

      {/* ─── CHOOSE YOUR ADVENTURE — newsbox image cards ──── */}
      <section className="section-dark">
        <h3 className="section-title">Choose Your Adventure</h3>
        <p className="section-kicker">
          Jump into long-term survival, seasonal competition, quick arcade rounds, party modes,
          and community events built around fair play.
        </p>

        <div className="newsbox-grid">
          {ADVENTURES.map((a) => (
            <Link
              key={a.name}
              href={a.href}
              className="newsbox"
              style={{ backgroundImage: `url(${a.bg})` }}
            >
              <div className="newsbox-overlay" />
              <div className="newsbox-text">
                <div className="newsbox-tag">{a.tag}</div>
                <div className="newsbox-title">{a.name}</div>
                <div className="newsbox-body">{a.body}</div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* ─── SUPPORT — perks-band ─────────────────────────── */}
      <section className="section-deep">
        <h3 className="section-title">Back the server. Keep the game fair.</h3>
        <p className="section-kicker">
          RealFiction support stays focused on style, identity, lobby fun, and community perks.
          No paid kits, no bought power, no shortcut around the rules.
        </p>
        <div className="perks-band">
          {SUPPORT_PERKS.map((p) => (
            <div key={p} className="perk">
              <div className="slot">
                <GemIcon />
              </div>
              <div className="label">{p}</div>
            </div>
          ))}
        </div>
        <div style={{ textAlign: "center", marginTop: 40 }}>
          <Link className="mc-button mc-button--gold" href="/store">
            Visit the Store
          </Link>
        </div>
      </section>

      {/* ─── VOTE & EARN REWARDS ──────────────────────────── */}
      <section className="section-dark">
        <h3 className="section-title">Vote &amp; Earn Rewards</h3>
        <p className="section-kicker">
          Vote daily to help RealFiction grow, build streaks, and earn server-safe rewards
          through your linked Minecraft account.
        </p>

        <div className="streak-card">
          <div>
            <div className="stat-eyebrow" style={{ color: "var(--text-mute)" }}>
              Your streak · 14 days
            </div>
            <div className="streak-blocks" style={{ marginTop: 12 }}>
              {Array.from({ length: 14 }).map((_, i) => (
                <span key={i} className="blk" />
              ))}
              {Array.from({ length: 16 }).map((_, i) => (
                <span key={`e${i}`} className="blk empty" />
              ))}
            </div>
            <div
              style={{
                marginTop: 14,
                fontSize: 13,
                color: "var(--text-dim)",
                fontFamily: "rf-light, sans-serif"
              }}
            >
              Streak +30 unlocks a cape and Epic crate.
            </div>
          </div>
          <Link className="mc-button" href="/vote">
            Open Voting Hub
          </Link>
        </div>
      </section>

      {/* ─── LIVE MAPS — tabs + map frame (client component) ─ */}
      <HomeLiveMaps />

      {/* ─── COMMUNITY — discord-block ────────────────────── */}
      <section className="section-dark">
        <h3 className="section-title">Join the Community</h3>
        <p className="section-kicker">
          Announcements, events, support, screenshots, and voice chat live in the RealFiction
          Discord. The server lives there too.
        </p>

        <div className="discord-block">
          <div>
            <div className="discord-feed">
              {DISCORD_FEED.map((m) => (
                <div key={m.c} className="feed-item">
                  <span className="channel">{m.c}</span>
                  <span className="meta">
                    {m.who} · {m.t}
                  </span>
                  <div className="msg">{m.n}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ textAlign: "center" }}>
            <DiscordIcon
              width={64}
              height={64}
              className="mx-auto mb-[18px] block text-[#5865f2]"
            />
            <p
              style={{
                fontFamily: "rf-light, sans-serif",
                color: "var(--text-dim)",
                marginBottom: 22,
                fontSize: 15
              }}
            >
              2,400+ players in the network. Drop in any time.
            </p>
            <a
              href="https://discord.com/invite/JkPpmzn"
              className="mc-button mc-button--discord"
            >
              <DiscordIcon /> Join Discord
            </a>
          </div>
        </div>
      </section>

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
