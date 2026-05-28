"use client"

import { useCallback, useEffect, useState } from "react"

/**
 * Choose Your Adventure grid — click a card to open a short description
 * window instead of navigating away. The mockup-styled newsbox image
 * cards stay the same visually; we just intercept the click and pop a
 * modal with the longer copy.
 *
 * Esc + backdrop click both close it. Focus is restored after close.
 */

export type Adventure = {
  name: string
  tag: string
  bg: string
  body: string
  long?: string
}

export function HomeAdventureGrid({ adventures }: { adventures: Adventure[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  const close = useCallback(() => setOpenIndex(null), [])

  useEffect(() => {
    if (openIndex === null) return

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenIndex(null)
      }
    }
    document.addEventListener("keydown", onKey)
    // Lock body scroll while the modal is open.
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [openIndex])

  const active = openIndex !== null ? adventures[openIndex] : null

  return (
    <>
      <div className="newsbox-grid">
        {adventures.map((a, i) => (
          <button
            key={a.name}
            type="button"
            className="newsbox"
            style={{ backgroundImage: `url(${a.bg})`, cursor: "pointer", border: 0, padding: 0, textAlign: "left", fontFamily: "inherit" }}
            onClick={() => setOpenIndex(i)}
            aria-haspopup="dialog"
            aria-label={`About ${a.name}`}
          >
            <div className="newsbox-overlay" />
            <div className="newsbox-text">
              <div className="newsbox-tag">{a.tag}</div>
              <div className="newsbox-title">{a.name}</div>
              <div className="newsbox-body">{a.body}</div>
            </div>
          </button>
        ))}
      </div>

      {active ? (
        <AdventureModal adventure={active} onClose={close} />
      ) : null}
    </>
  )
}

function AdventureModal({
  adventure,
  onClose
}: {
  adventure: Adventure
  onClose: () => void
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="adventure-modal-title"
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
          width: "min(560px, 100%)",
          maxHeight: "calc(100vh - 40px)",
          overflowY: "auto",
          padding: 0,
          animation: "rfFadeUp 220ms ease",
          background: "var(--navy-card)",
          border: "1px solid rgba(242, 198, 109, 0.25)",
          boxShadow: "0 22px 60px rgba(0,0,0,0.55)"
        }}
      >
        <div
          style={{
            position: "relative",
            aspectRatio: "16 / 9",
            backgroundImage: `url(${adventure.bg})`,
            backgroundSize: "cover",
            backgroundPosition: "center"
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "linear-gradient(180deg, rgba(2,20,41,0.05) 50%, rgba(2,20,41,0.85) 100%)"
            }}
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="mc-button mc-button--ghost mc-button--sm"
            style={{
              position: "absolute",
              top: 12,
              right: 12,
              padding: "6px 10px"
            }}
          >
            Close
          </button>
        </div>

        <div style={{ padding: "22px 24px 24px" }}>
          <div
            className="newsbox-tag"
            style={{ marginBottom: 6 }}
          >
            {adventure.tag}
          </div>
          <h3
            id="adventure-modal-title"
            style={{
              fontFamily: "rf-h1, sans-serif",
              fontSize: 28,
              color: "white",
              margin: 0,
              lineHeight: 1.1
            }}
          >
            {adventure.name}
          </h3>
          <p
            style={{
              marginTop: 14,
              color: "var(--text-dim)",
              fontFamily: "rf-light, sans-serif",
              fontSize: 15,
              lineHeight: 1.65
            }}
          >
            {adventure.long ?? adventure.body}
          </p>

          <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
            <p
              style={{
                margin: 0,
                fontSize: 12,
                color: "var(--text-mute)",
                fontFamily: "rf-light, sans-serif"
              }}
            >
              Connect at <span style={{ color: "var(--gold)", fontFamily: "rf-mc, monospace" }}>realfiction.live</span> and pick this mode from the Lobby compass.
            </p>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes rfFadeBackdrop {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes rfFadeUp {
          from { opacity: 0; transform: translateY(8px) scale(0.985); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  )
}
