"use client"

import { useState } from "react"

import { DoorIcon } from "@/components/minecraft-icons"
import { getSupabaseBrowserClient } from "@/lib/supabase/browser"

export function AccountSignOutButton() {
  const [busy, setBusy] = useState(false)

  async function signOut() {
    setBusy(true)
    const supabase = getSupabaseBrowserClient()

    if (supabase) {
      await supabase.auth.signOut()
    }

    window.location.href = "/account"
  }

  // Styled to match the Settings / Home links in the account header so the
  // three sit as one consistent row instead of one heavier outlined button.
  return (
    <button
      className="inline-flex items-center gap-2 rounded-md border border-white/12 bg-black/24 px-3 py-2 text-sm font-semibold text-muted-foreground backdrop-blur transition hover:border-amber-200/35 hover:text-amber-100 disabled:opacity-60"
      disabled={busy}
      onClick={signOut}
      type="button"
    >
      <DoorIcon className="h-4 w-4" />
      {busy ? "Leaving..." : "Sign out"}
    </button>
  )
}
