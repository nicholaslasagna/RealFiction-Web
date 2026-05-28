"use client"

import Link from "next/link"
import { ArrowLeft, CircleCheckBig, LockKeyhole } from "lucide-react"
import { FormEvent, useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getSupabaseBrowserClient } from "@/lib/supabase/browser"
import { cn } from "@/lib/utils"

type State = "loading" | "ready" | "invalid" | "done"

export function ResetPasswordForm() {
  const [state, setState] = useState<State>("loading")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const supabase = getSupabaseBrowserClient()
    if (!supabase) {
      setState("invalid")
      return
    }

    let resolved = false
    const markReady = () => {
      resolved = true
      setState("ready")
    }

    // createBrowserClient auto-detects the recovery token in the URL and
    // establishes a temporary session; that surfaces here.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        markReady()
      }
    })

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) {
        markReady()
      }
    })

    const timer = window.setTimeout(() => {
      if (!resolved) {
        setState("invalid")
      }
    }, 2500)

    return () => {
      sub.subscription.unsubscribe()
      window.clearTimeout(timer)
    }
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    const form = new FormData(event.currentTarget)
    const password = String(form.get("password") ?? "")
    const confirm = String(form.get("confirm") ?? "")

    if (password !== confirm) {
      setError("Those passwords do not match.")
      return
    }

    const supabase = getSupabaseBrowserClient()
    if (!supabase) {
      setError("Accounts are not available right now.")
      return
    }

    setBusy(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setBusy(false)

    if (updateError) {
      setError("We could not update your password. The reset link may have expired.")
      return
    }

    setState("done")
    window.setTimeout(() => window.location.assign("/account"), 1600)
  }

  return (
    <div className="mx-auto w-full max-w-[460px] rounded-lg border border-amber-200/12 bg-[#080d18]/92 p-6 shadow-[0_30px_90px_rgba(0,0,0,0.48)] backdrop-blur-xl md:p-9">
      {state === "done" ? (
        <div className="text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-emerald-300/25 bg-emerald-400/12 text-emerald-200">
            <CircleCheckBig className="h-8 w-8" />
          </div>
          <h1 className="display-font mt-6 text-3xl font-semibold text-white">Password updated</h1>
          <p className="mt-3 text-sm text-muted-foreground">Taking you to your account...</p>
        </div>
      ) : state === "invalid" ? (
        <div className="text-center">
          <h1 className="display-font text-3xl font-semibold text-white">Reset link expired</h1>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-muted-foreground">
            This password reset link is invalid or has expired. Request a new one from the sign-in page.
          </p>
          <Button asChild className="mt-6" variant="outline">
            <Link href="/account">
              <ArrowLeft className="h-4 w-4" />
              Back to sign in
            </Link>
          </Button>
        </div>
      ) : (
        <>
          <h1 className="display-font text-3xl font-semibold text-white md:text-4xl">Choose a new password</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Pick something at least 8 characters long.
          </p>

          <form className="mt-7 grid gap-5" onSubmit={submit}>
            <label className="grid gap-2 text-sm font-bold text-slate-100">
              New password
              <span className="relative">
                <LockKeyhole className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
                <Input
                  autoComplete="new-password"
                  className="h-12 border-white/10 bg-white/[0.035] pl-10"
                  minLength={8}
                  name="password"
                  placeholder="At least 8 characters"
                  required
                  type="password"
                />
              </span>
            </label>
            <label className="grid gap-2 text-sm font-bold text-slate-100">
              Confirm password
              <span className="relative">
                <LockKeyhole className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
                <Input
                  autoComplete="new-password"
                  className="h-12 border-white/10 bg-white/[0.035] pl-10"
                  minLength={8}
                  name="confirm"
                  placeholder="Re-enter your password"
                  required
                  type="password"
                />
              </span>
            </label>

            <Button className="h-12 w-full text-base" disabled={busy || state === "loading"} type="submit">
              {state === "loading" ? "Loading..." : busy ? "Saving..." : "Update password"}
            </Button>

            {error ? (
              <p className={cn("rounded-md border border-rose-400/25 bg-rose-500/10 p-3 text-sm text-rose-100")}>{error}</p>
            ) : null}
          </form>
        </>
      )}
    </div>
  )
}
