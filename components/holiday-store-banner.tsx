"use client"

import { useEffect, useState } from "react"

import { HOLIDAYS } from "@/lib/holidays"

/**
 * A slim festive strip shown at the top of the Store during an active holiday.
 * Reads the `theme-<id>` class the boot script set on <html> and pulls the
 * holiday's `storeBanner` copy from the registry. The amber-* utility classes
 * retint to the holiday palette automatically, so no per-holiday styling is
 * needed. Renders nothing outside a holiday window.
 */
export function HolidayStoreBanner() {
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    const id = Array.from(document.documentElement.classList)
      .filter((cls) => cls.startsWith("theme-") && cls !== "theme-active")
      .map((cls) => cls.slice("theme-".length))
      .find((candidate) => HOLIDAYS[candidate])
    if (id) setMessage(HOLIDAYS[id].storeBanner)
  }, [])

  if (!message) return null

  return (
    <div className="border-b border-amber-200/25 bg-amber-200/10 text-amber-100">
      <p className="container-shell py-2.5 text-center text-sm font-medium tracking-wide">{message}</p>
    </div>
  )
}
