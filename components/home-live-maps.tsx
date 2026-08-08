"use client"

import { useState } from "react"

const MAP_TABS = [
  { id: "smp", name: "SMP", url: "map.realfiction.live", bg: "/images/hero1.png" },
  { id: "fac", name: "Factions", url: "map2.realfiction.live", bg: "/images/tournaments.png" },
  { id: "ana", name: "Anarchy", url: "map.realanarchy.live", bg: "/images/hero2.png" }
] as const

type TabId = (typeof MAP_TABS)[number]["id"]

export function HomeLiveMaps() {
  const [active, setActive] = useState<TabId>("smp")
  const tab = MAP_TABS.find((t) => t.id === active) ?? MAP_TABS[0]

  return (
    <section className="section-tinted">
      <h2 className="section-title">Live Maps</h2>
      <p className="section-kicker">
        Browse every public RealFiction world from above. Live BlueMap renders update with every save.
      </p>

      <div className="rf-tabs">
        {MAP_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`rf-tab ${t.id === active ? "active" : ""}`}
            onClick={() => setActive(t.id)}
          >
            {t.name}
          </button>
        ))}
      </div>

      <div className="map-frame">
        {/* No pin overlay. Five pins used to sit at fixed percentages here,
            unchanged across all three tabs — so they marked nothing, and on a
            live-render preview they read as real locations. */}
        <div className="shot" style={{ backgroundImage: `url(${tab.bg})` }}>
          <div className="label">{tab.url} · live render</div>
        </div>
      </div>

      <div
        style={{
          textAlign: "center",
          marginTop: 24,
          display: "flex",
          justifyContent: "center",
          gap: 12,
          flexWrap: "wrap"
        }}
      >
        {MAP_TABS.map((t) => (
          <a
            key={t.id}
            href={`https://${t.url}`}
            className="f-mono"
            style={{
              fontSize: 12.5,
              color: "var(--text-dim)",
              textDecoration: "none",
              padding: "7px 12px",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.1)"
            }}
          >
            {t.url} ↗
          </a>
        ))}
      </div>
    </section>
  )
}
