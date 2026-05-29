"use client"

import Link from "next/link"
import type { ComponentType } from "react"
import { useCallback, useEffect, useState } from "react"

import {
  ArmorIcon,
  BoneIcon,
  ChestIcon,
  DyeIcon,
  ElytraIcon,
  FireworkRocketIcon,
  NetherStarIcon
} from "@/components/minecraft-icons"

/**
 * Homepage "what we sell" band. Each perk is a clickable chip that opens a
 * short description plus a button to go buy it in the store. The store button
 * deep-links to that perk's category (the storefront reads the URL hash and
 * pre-selects it). Esc + backdrop click close the dialog.
 */

type Perk = {
  label: string
  icon: ComponentType<{ size?: number; className?: string }>
  /** Store category id used for the deep link (/store#<category>). */
  category: string
  blurb: string
}

const PERKS: Perk[] = [
  {
    label: "Cosmetics",
    icon: ArmorIcon,
    category: "cosmetics",
    blurb: "Profile effects, lobby entrances, badges, and seasonal flair. Pure style — never a gameplay edge."
  },
  {
    label: "RealVIP",
    icon: NetherStarIcon,
    category: "supporter",
    blurb: "A supporter rank with chat flair, profile frames, and friendly lobby-only perks that help keep the network running."
  },
  {
    label: "Pets",
    icon: BoneIcon,
    category: "pets",
    blurb: "Bring a lobby companion along — foxes, allays, a tiny dragon, and more follow you around spawn."
  },
  {
    label: "Particles",
    icon: FireworkRocketIcon,
    category: "particles",
    blurb: "Trails, auras, and sparkle effects that follow you around the lobby and show off your style."
  },
  {
    label: "Username colors",
    icon: DyeIcon,
    category: "identity",
    blurb: "Pick a name color that fits your style in chat and the tab list."
  },
  {
    label: "Lobby flight",
    icon: ElytraIcon,
    category: "lobby",
    blurb: "Fly around hubs and spawn showcases. Lobby-only — never in survival, factions, or PvP."
  },
  {
    label: "Gift cards",
    icon: ChestIcon,
    category: "gift-cards",
    blurb: "Store credit to spend on anything in the shop — or send it to a friend as a gift."
  }
]

export function HomePerksBand() {
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const close = useCallback(() => setOpenIndex(null), [])

  useEffect(() => {
    if (openIndex === null) {
      return
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenIndex(null)
      }
    }
    document.addEventListener("keydown", onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [openIndex])

  const active = openIndex !== null ? PERKS[openIndex] : null

  return (
    <>
      <div className="perks-band">
        {PERKS.map((perk, index) => {
          const Icon = perk.icon
          return (
            <button
              key={perk.label}
              type="button"
              className="perk"
              onClick={() => setOpenIndex(index)}
              aria-haspopup="dialog"
              aria-label={`About ${perk.label}`}
              style={{ cursor: "pointer", appearance: "none", textAlign: "left", fontFamily: "inherit" }}
            >
              <div className="slot">
                <Icon size={22} />
              </div>
              <div className="label">{perk.label}</div>
            </button>
          )
        })}
      </div>

      {active ? <PerkModal perk={active} onClose={close} /> : null}
    </>
  )
}

function PerkModal({ perk, onClose }: { perk: Perk; onClose: () => void }) {
  const Icon = perk.icon
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="perk-modal-title"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        display: "grid",
        placeItems: "center",
        background: "rgba(0, 6, 14, 0.78)",
        backdropFilter: "blur(4px)",
        padding: 20,
        animation: "rfFadeBackdrop 180ms ease"
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="minecraft-panel"
        style={{
          width: "min(440px, 100%)",
          padding: "26px 26px 24px",
          animation: "rfFadeUp 220ms ease",
          background: "var(--navy-card)",
          border: "1px solid rgba(242, 198, 109, 0.25)",
          boxShadow: "0 22px 60px rgba(0,0,0,0.55)"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span
            className="slot"
            style={{ width: 52, height: 52, display: "grid", placeItems: "center", flexShrink: 0 }}
          >
            <Icon size={30} />
          </span>
          <h3
            id="perk-modal-title"
            style={{
              fontFamily: "rf-h1, sans-serif",
              fontSize: 26,
              color: "white",
              margin: 0,
              lineHeight: 1.1
            }}
          >
            {perk.label}
          </h3>
        </div>

        <p style={{ marginTop: 16, color: "rgb(190, 200, 214)", fontSize: 15, lineHeight: 1.6 }}>
          {perk.blurb}
        </p>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 22 }}>
          <Link
            className="mc-button mc-button--gold"
            href={`/store#${perk.category}`}
            onClick={onClose}
          >
            Get {perk.label} in the store
          </Link>
          <button type="button" className="mc-button mc-button--ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
