import Link from "next/link"

import { socials } from "@/lib/data"

/* ============================================================
   Floating bottom-left icon bar — matches the mockup exactly:
   YouTube red, Twitter black, Instagram pink, Discord blue.
   ============================================================ */

function SocialIcon({ label }: { label: string }) {
  const name = label.toLowerCase()

  if (name === "discord") {
    return (
      <svg aria-hidden viewBox="0 0 24 24" width="22" height="22" role="img">
        <path
          fill="currentColor"
          d="M19.7 5.3A18.3 18.3 0 0 0 15.2 4l-.3.6c1.6.4 3 1 4.2 1.8a13.8 13.8 0 0 0-13.8 0c1.2-.7 2.6-1.4 4.2-1.8L9.2 4a18.3 18.3 0 0 0-4.5 1.3C2.4 8.7 1.8 12.1 2.1 15.4a18.5 18.5 0 0 0 5.6 2.8c.5-.7.9-1.4 1.2-2.2-.7-.3-1.4-.7-2-1.1.2-.1.4-.3.5-.4a13.1 13.1 0 0 0 11.3 0c.2.1.3.3.5.4-.6.4-1.3.8-2 1.1.3.8.7 1.5 1.2 2.2a18.5 18.5 0 0 0 5.6-2.8c.4-3.8-.6-7.2-3.3-10.1ZM8.7 13.5c-1.1 0-2-1-2-2.2s.9-2.3 2-2.3 2 1 2 2.3-.9 2.2-2 2.2Zm6.6 0c-1.1 0-2-1-2-2.2s.9-2.3 2-2.3 2 1 2 2.3-.9 2.2-2 2.2Z"
        />
      </svg>
    )
  }

  if (name === "youtube") {
    return (
      <svg aria-hidden viewBox="0 0 24 24" width="22" height="22" role="img">
        <path
          fill="currentColor"
          d="M21.6 7.2c-.2-.9-.9-1.6-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4c-.9.2-1.6.9-1.8 1.8C2 8.8 2 12 2 12s0 3.2.4 4.8c.2.9.9 1.6 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4c.9-.2 1.6-.9 1.8-1.8.4-1.6.4-4.8.4-4.8s0-3.2-.4-4.8zM10 15V9l5.2 3-5.2 3z"
        />
      </svg>
    )
  }

  if (name === "x" || name === "twitter") {
    return (
      <svg aria-hidden viewBox="0 0 24 24" width="18" height="18" role="img">
        <path
          fill="currentColor"
          d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z"
        />
      </svg>
    )
  }

  // Instagram default
  return (
    <svg aria-hidden viewBox="0 0 24 24" width="20" height="20" role="img" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" />
    </svg>
  )
}

function classFor(label: string) {
  const name = label.toLowerCase()
  if (name === "youtube") return "youtube"
  if (name === "x" || name === "twitter") return "twitter"
  if (name === "instagram") return "instagram"
  if (name === "discord") return "discord"
  return ""
}

export function SocialRail() {
  // Render in mockup order: YouTube → Twitter/X → Instagram → Discord
  const order = ["YouTube", "X", "Instagram", "Discord"]
  const sorted = order
    .map((label) => socials.find((s) => s.label === label))
    .filter((s): s is (typeof socials)[number] => Boolean(s))

  return (
    // A labelled <aside> rather than a bare div: axe flags floating content
    // outside any landmark, and a screen-reader user landing here otherwise gets
    // an unannounced pile of links with no way to skip past them.
    <aside className="icon-bar" aria-label="RealFiction community links">
      {sorted.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={classFor(item.label)}
          aria-label={item.label}
        >
          <SocialIcon label={item.label} />
        </Link>
      ))}
    </aside>
  )
}
