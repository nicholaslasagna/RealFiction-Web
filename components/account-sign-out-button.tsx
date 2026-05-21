"use client"

import { LogOut } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
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

  return (
    <Button disabled={busy} onClick={signOut} type="button" variant="outline">
      <LogOut className="h-4 w-4" />
      {busy ? "Leaving..." : "Sign out"}
    </Button>
  )
}
