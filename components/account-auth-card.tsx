"use client"

import Link from "next/link"
import { Check, Fingerprint, LockKeyhole, Mail, UserRound } from "lucide-react"
import { FormEvent, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getSupabaseBrowserClient } from "@/lib/supabase/browser"
import { cn } from "@/lib/utils"

type AuthMode = "signin" | "signup"

export function AccountAuthCard() {
  const [mode, setMode] = useState<AuthMode>("signin")
  const [remember, setRemember] = useState(true)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setStatus(null)

    const form = new FormData(event.currentTarget)
    const email = String(form.get("email") ?? "").trim()
    const password = String(form.get("password") ?? "")
    const minecraftUsername = String(form.get("minecraftUsername") ?? "").trim()
    const supabase = getSupabaseBrowserClient()

    if (!supabase) {
      setStatus("Sign in is not ready here yet.")
      setBusy(false)
      return
    }

    const result =
      mode === "signin"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: {
              data: minecraftUsername ? { minecraft_username: minecraftUsername } : undefined
            }
          })

    if (result.error) {
      setStatus(mode === "signin" ? "We could not sign you in. Check your email and password." : "We could not create that account yet.")
      setBusy(false)
      return
    }

    setStatus(mode === "signin" ? "Signed in. Welcome back." : "Account created. Check your email to finish joining.")
    setBusy(false)
  }

  return (
    <div className="w-full max-w-[520px] rounded-lg border border-amber-200/12 bg-[#080d18]/92 p-6 shadow-[0_30px_90px_rgba(0,0,0,0.48)] backdrop-blur-xl md:p-9">
      <div className="flex rounded-md border border-amber-200/12 bg-black/22 p-1">
        {[
          { id: "signin", label: "Sign in" },
          { id: "signup", label: "Create account" }
        ].map((item) => (
          <button
            key={item.id}
            className={cn(
              "h-10 flex-1 rounded-[6px] text-sm font-bold transition",
              mode === item.id
                ? "bg-amber-300 text-[#211504] shadow-[0_8px_22px_rgba(242,198,109,0.22)]"
                : "text-muted-foreground hover:text-amber-100"
            )}
            onClick={() => {
              setMode(item.id as AuthMode)
              setStatus(null)
            }}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="mt-8">
        <h1 className="display-font text-4xl font-semibold leading-tight text-white md:text-5xl">
          {mode === "signin" ? "Sign in to RealFiction" : "Create your RealFiction account"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {mode === "signin"
            ? "Welcome back. Pick up your rewards, cosmetics, and linked Minecraft profile."
            : "Join the community, link your Minecraft account, and keep your rewards in one place."}
        </p>
      </div>

      <form className="mt-7 grid gap-5" onSubmit={submit}>
        <label className="grid gap-2 text-sm font-bold text-slate-100">
          Email
          <span className="relative">
            <Mail className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
            <Input
              autoComplete="email"
              className="h-12 border-white/10 bg-white/[0.035] pl-10"
              name="email"
              placeholder="you@example.com"
              required
              type="email"
            />
          </span>
        </label>

        <label className="grid gap-2 text-sm font-bold text-slate-100">
          <span className="flex items-center justify-between gap-3">
            Password
            {mode === "signin" ? (
              <Link className="text-xs font-bold text-amber-300 hover:text-amber-200" href="/contact">
                Forgot your password?
              </Link>
            ) : null}
          </span>
          <span className="relative">
            <LockKeyhole className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
            <Input
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              className="h-12 border-white/10 bg-white/[0.035] pl-10"
              minLength={8}
              name="password"
              placeholder="At least 8 characters"
              required
              type="password"
            />
          </span>
        </label>

        {mode === "signup" ? (
          <label className="grid gap-2 text-sm font-bold text-slate-100">
            Minecraft username
            <span className="relative">
              <UserRound className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
              <Input
                autoComplete="username"
                className="h-12 border-white/10 bg-white/[0.035] pl-10"
                name="minecraftUsername"
                placeholder="Optional for now"
              />
            </span>
          </label>
        ) : null}

        <button
          className="flex w-fit items-center gap-3 text-left text-sm text-slate-200"
          onClick={() => setRemember((value) => !value)}
          type="button"
        >
          <span
            className={cn(
              "flex h-5 w-5 items-center justify-center rounded border transition",
              remember ? "border-amber-300 bg-amber-300 text-[#211504]" : "border-white/18 bg-white/[0.035]"
            )}
          >
            {remember ? <Check className="h-3.5 w-3.5" /> : null}
          </span>
          Remember me on this device
        </button>

        <div className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
          <div className="flex items-center gap-3 rounded-md border border-white/12 bg-black/20 px-4 py-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-400 text-[#071525]">
              <Check className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-white">Security check ready</div>
              <div className="text-xs text-muted-foreground">We keep sign-in simple and protected.</div>
            </div>
          </div>
        </div>

        <Button className="h-12 w-full text-base" disabled={busy} type="submit">
          <Fingerprint className="h-4 w-4" />
          {busy ? "Working..." : mode === "signin" ? "Sign in" : "Create account"}
        </Button>

        {status ? (
          <p className="rounded-md border border-amber-200/14 bg-black/24 p-3 text-sm text-muted-foreground">
            {status}
          </p>
        ) : null}
      </form>

      <div className="mt-7 border-t border-white/10 pt-5 text-center text-sm text-muted-foreground">
        {mode === "signin" ? (
          <>
            New to RealFiction?{" "}
            <button className="font-bold text-amber-300 hover:text-amber-200" onClick={() => setMode("signup")} type="button">
              Create account
            </button>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <button className="font-bold text-amber-300 hover:text-amber-200" onClick={() => setMode("signin")} type="button">
              Sign in
            </button>
          </>
        )}
        <span className="mx-2 text-white/25">·</span>
        <Link className="hover:text-amber-100" href="/">
          Continue as guest
        </Link>
      </div>
    </div>
  )
}
