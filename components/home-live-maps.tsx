"use client"

import { useState } from "react"

const MAP_TABS = [
  { id: "smp", name: "SMP", url: "map.realfiction.live", bg: "/images/hero1.png" },
  { id: "fac", name: "Factions", url: "map2.realfiction.live", bg: "/images/tournaments.png" },
  { id: "ana", name: "Anarchy", url: "map.realanarchy.live", bg: "/images/hero2.png" }
] as const

type TabId = (typeof MAP_TABS)[number]["id"]

const PIN_POSITIONS: ReadonlyArray<readonly [number, number]> = [
  [18, 42],
  [38, 28],
  [55, 68],
  [72, 38],
  [88, 60]
]

export function HomeLiveMaps() {
  const [active, setActive] = useState<TabId>("smp")
  const tab = MAP_TABS.find((t) => t.id === active) ?? MAP_TABS[0]

  return (
    <section className="section-tinted">
      <h3 className="section-title">Live Maps</h3>
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
        <div className="shot" style={{ backgroundImage: `url(${tab.bg})` }}>
          {PIN_POSITIONS.map(([l, t], i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                left: `${l}%`,
                top: `${t}%`,
                transform: "translate(-50%, -100%)",
                color: i === 1 ? "var(--gold)" : "var(--mc-green)",
                zIndex: 1
              }}
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ filter: "drop-shadow(0 4px 8px rgba(0,0,0,0.6))" }}
              >
                <path d="M12 22s7-6.3 7-12a7 7 0 1 0-14 0c0 5.7 7 12 7 12z" />
                <circle cx="12" cy="10" r="2.5" />
              </svg>
            </div>
          ))}
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
