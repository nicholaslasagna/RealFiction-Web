"use client"

import Link from "next/link"
import { ArrowLeft, Fingerprint, LockKeyhole, Mail, ShieldQuestion, UserRound } from "lucide-react"
import { FormEvent, useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Turnstile } from "@/components/turnstile"
import { getSupabaseBrowserClient } from "@/lib/supabase/browser"
import { cn } from "@/lib/utils"

type AuthMode = "signin" | "signup" | "forgot"
type Notice = { kind: "error" | "info"; text: string } | null
type SentPanel = { kind: "confirm" | "reset"; email: string } | null

export function AccountAuthCard() {
  const [mode, setMode] = useState<AuthMode>("signin")
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  const [sent, setSent] = useState<SentPanel>(null)
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [captchaKey, setCaptchaKey] = useState(0)
  const [resendCooldown, setResendCooldown] = useState(0)

  // Counts the resend cooldown down once per second. Matches the Supabase
  // per-user email interval (60s) so resending can't hit the rate limit.
  useEffect(() => {
    if (resendCooldown <= 0) {
      return
    }
    const timer = window.setTimeout(() => setResendCooldown((seconds) => Math.max(0, seconds - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [resendCooldown])

  const cloudflareCheckEnabled =
    Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) || process.env.NODE_ENV !== "production"

  function resetCaptcha() {
    setCaptchaToken(null)
    setCaptchaKey((key) => key + 1)
  }

  function switchMode(next: AuthMode) {
    setMode(next)
    setNotice(null)
    setSent(null)
    setMfaFactorId(null)
  }

  function goToAccount() {
    // Hard navigation so the server re-reads the new auth cookie and renders the
    // signed-in dashboard.
    window.location.assign("/account")
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setNotice(null)

    const form = new FormData(event.currentTarget)
    const email = String(form.get("email") ?? "").trim()
    const password = String(form.get("password") ?? "")
    const minecraftUsername = String(form.get("minecraftUsername") ?? "").trim()
    const supabase = getSupabaseBrowserClient()

    if (!supabase) {
      setNotice({ kind: "error", text: "Accounts are not available right now. Please try again later." })
      setBusy(false)
      return
    }

    try {
      if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/account/reset-password`,
          captchaToken: captchaToken ?? undefined
        })
        if (error) {
          setNotice({ kind: "error", text: "We could not send a reset email. Check the address and try again." })
          return
        }
        setSent({ kind: "reset", email })
        setResendCooldown(60)
        return
      }

      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
          options: { captchaToken: captchaToken ?? undefined }
        })
        if (error) {
          setNotice({ kind: "error", text: "We could not sign you in. Check your email and password." })
          return
        }

        // If the account has 2FA, step up before landing on the dashboard.
        const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
        if (aal && aal.nextLevel === "aal2" && aal.nextLevel !== aal.currentLevel) {
          const { data: factors } = await supabase.auth.mfa.listFactors()
          const totp = factors?.totp?.find((factor) => factor.status === "verified") ?? factors?.totp?.[0]
          if (totp) {
            setMfaFactorId(totp.id)
            setNotice({ kind: "info", text: "Enter the 6-digit code from your authenticator app." })
            return
          }
        }
        goToAccount()
        return
      }

      // mode === "signup"
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          captchaToken: captchaToken ?? undefined,
          emailRedirectTo: `${window.location.origin}/account`,
          data: minecraftUsername ? { minecraft_username: minecraftUsername } : undefined
        }
      })
      if (error) {
        setNotice({ kind: "error", text: "We could not create that account. The email may already be in use." })
        return
      }
      if (data.session) {
        // Email confirmation is disabled — they're signed in immediately.
        goToAccount()
        return
      }
      setSent({ kind: "confirm", email })
      setResendCooldown(60)
    } finally {
      resetCaptcha()
      setBusy(false)
    }
  }

  async function verifyMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!mfaFactorId) {
      return
    }
    setBusy(true)
    setNotice(null)

    const code = String(new FormData(event.currentTarget).get("code") ?? "").trim()
    const supabase = getSupabaseBrowserClient()
    if (!supabase) {
      setBusy(false)
      return
    }

    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: mfaFactorId, code })
    if (error) {
      setNotice({ kind: "error", text: "That code did not match. Try again." })
      setBusy(false)
      return
    }
    goToAccount()
  }

  async function resend() {
    if (!sent || resendCooldown > 0) {
      return
    }
    const supabase = getSupabaseBrowserClient()
    if (!supabase) {
      return
    }
    setBusy(true)
    if (sent.kind === "reset") {
      await supabase.auth.resetPasswordForEmail(sent.email, {
        redirectTo: `${window.location.origin}/account/reset-password`
      })
    } else {
      await supabase.auth.resend({ type: "signup", email: sent.email })
    }
    setBusy(false)
    setResendCooldown(60)
    setNotice({ kind: "info", text: "Sent again. It can take a minute to arrive." })
  }

  return (
    <div className="mx-auto w-full max-w-[520px] rounded-lg border border-amber-200/12 bg-[#080d18]/92 p-6 shadow-[0_30px_90px_rgba(0,0,0,0.48)] backdrop-blur-xl md:p-9">
      {sent ? (
        <EmailSentPanel sent={sent} busy={busy} cooldown={resendCooldown} notice={notice} onResend={resend} onBack={() => switchMode("signin")} />
      ) : mfaFactorId ? (
        <MfaPanel busy={busy} notice={notice} onSubmit={verifyMfa} onBack={() => switchMode("signin")} />
      ) : (
        <>
          <div className="flex rounded-md border border-amber-200/12 bg-black/22 p-1">
            {[
              { id: "signin", label: "Sign in" },
              { id: "signup", label: "Create account" }
            ].map((item) => (
              <button
                key={item.id}
                className={cn(
                  "h-10 flex-1 rounded-[6px] text-sm font-bold transition",
                  (mode === item.id || (mode === "forgot" && item.id === "signin"))
                    ? "bg-amber-300 text-[#211504] shadow-[0_8px_22px_rgba(242,198,109,0.22)]"
                    : "text-muted-foreground hover:text-amber-100"
                )}
                onClick={() => switchMode(item.id as AuthMode)}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="mt-8">
            <h1 className="display-font text-4xl font-semibold leading-tight text-white md:text-5xl">
              {mode === "signin" ? "Sign in to RealFiction" : mode === "signup" ? "Create your RealFiction account" : "Reset your password"}
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {mode === "signin"
                ? "Welcome back. Pick up your rewards, cosmetics, and linked Minecraft profile."
                : mode === "signup"
                  ? "Join the community, link your Minecraft account, and keep your rewards in one place."
                  : "Enter your email and we'll send you a link to choose a new password."}
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

            {mode !== "forgot" ? (
              <label className="grid gap-2 text-sm font-bold text-slate-100">
                <span className="flex items-center justify-between gap-3">
                  Password
                  {mode === "signin" ? (
                    <button
                      className="text-xs font-bold text-amber-300 hover:text-amber-200"
                      onClick={() => switchMode("forgot")}
                      type="button"
                    >
                      Forgot your password?
                    </button>
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
            ) : null}

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

            <div className="grid gap-2 text-sm font-bold text-slate-100">
              Cloudflare check
              <div className="flex min-h-[86px] justify-center rounded-lg border border-white/10 bg-white/[0.035] p-3">
                <Turnstile key={captchaKey} onToken={setCaptchaToken} />
              </div>
            </div>

            <Button className="h-12 w-full text-base" disabled={busy || (cloudflareCheckEnabled && !captchaToken)} type="submit">
              <Fingerprint className="h-4 w-4" />
              {busy
                ? "Working..."
                : mode === "signin"
                  ? "Sign in"
                  : mode === "signup"
                    ? "Create account"
                    : "Send reset link"}
            </Button>

            {notice ? <NoticeLine notice={notice} /> : null}
          </form>

          <div className="mt-7 border-t border-white/10 pt-5 text-center text-sm text-muted-foreground">
            {mode === "forgot" ? (
              <button className="font-bold text-amber-300 hover:text-amber-200" onClick={() => switchMode("signin")} type="button">
                Back to sign in
              </button>
            ) : mode === "signin" ? (
              <>
                New to RealFiction?{" "}
                <button className="font-bold text-amber-300 hover:text-amber-200" onClick={() => switchMode("signup")} type="button">
                  Create account
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button className="font-bold text-amber-300 hover:text-amber-200" onClick={() => switchMode("signin")} type="button">
                  Sign in
                </button>
              </>
            )}
            <span className="mx-2 text-white/25">·</span>
            <Link className="hover:text-amber-100" href="/">
              Continue as guest
            </Link>
          </div>
        </>
      )}
    </div>
  )
}

function NoticeLine({ notice }: { notice: NonNullable<Notice> }) {
  return (
    <p
      className={cn(
        "rounded-md border p-3 text-sm",
        notice.kind === "error"
          ? "border-rose-400/25 bg-rose-500/10 text-rose-100"
          : "border-amber-200/16 bg-black/24 text-muted-foreground"
      )}
    >
      {notice.text}
    </p>
  )
}

function EmailSentPanel({
  sent,
  busy,
  cooldown,
  notice,
  onResend,
  onBack
}: {
  sent: NonNullable<SentPanel>
  busy: boolean
  cooldown: number
  notice: Notice
  onResend: () => void
  onBack: () => void
}) {
  const isConfirm = sent.kind === "confirm"

  return (
    <div className="rf-fade-up text-center">
      <div className="mx-auto h-20 w-20">
        <svg viewBox="0 0 52 52" className="h-20 w-20" aria-hidden="true">
          <circle className="rf-check-ring" cx="26" cy="26" r="24" fill="none" stroke="#34d399" strokeWidth="3" />
          <path
            className="rf-check-mark"
            d="M15 27 l7 7 l15 -16"
            fill="none"
            stroke="#34d399"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <h1 className="display-font mt-5 text-3xl font-semibold text-white md:text-4xl">
        {isConfirm ? "Email verification sent" : "Reset link sent"}
      </h1>
      <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-muted-foreground">
        {isConfirm
          ? "Check your email to finish joining. We sent a verification link to"
          : "Check your email to choose a new password. We sent a link to"}{" "}
        <span className="font-semibold text-amber-100">{sent.email}</span>.
      </p>
      <p className="mx-auto mt-3 max-w-sm text-xs text-muted-foreground">
        Can&rsquo;t find it? Check spam, or resend below.
      </p>

      {notice ? (
        <div className="mt-4">
          <NoticeLine notice={notice} />
        </div>
      ) : null}

      <div className="mt-6 grid gap-2">
        <Button disabled={busy || cooldown > 0} onClick={onResend} type="button" variant="outline">
          {busy ? "Sending..." : cooldown > 0 ? `Resend in ${cooldown}s` : "Resend email"}
        </Button>
        <Button onClick={onBack} type="button" variant="ghost">
          <ArrowLeft className="h-4 w-4" />
          Back to sign in
        </Button>
      </div>
    </div>
  )
}

function MfaPanel({
  busy,
  notice,
  onSubmit,
  onBack
}: {
  busy: boolean
  notice: Notice
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onBack: () => void
}) {
  return (
    <div>
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-amber-200/25 bg-amber-300/12 text-amber-200">
        <ShieldQuestion className="h-8 w-8" />
      </div>
      <h1 className="display-font mt-6 text-center text-3xl font-semibold text-white md:text-4xl">Two-step verification</h1>
      <p className="mx-auto mt-3 max-w-sm text-center text-sm leading-6 text-muted-foreground">
        Enter the 6-digit code from your authenticator app to finish signing in.
      </p>

      <form className="mt-6 grid gap-4" onSubmit={onSubmit}>
        <Input
          autoComplete="one-time-code"
          className="h-14 text-center font-mono text-2xl tracking-[0.5em]"
          inputMode="numeric"
          maxLength={6}
          name="code"
          pattern="[0-9]*"
          placeholder="000000"
          required
        />
        <Button className="h-12 w-full text-base" disabled={busy} type="submit">
          {busy ? "Checking..." : "Verify"}
        </Button>
        {notice ? <NoticeLine notice={notice} /> : null}
      </form>

      <div className="mt-6 text-center">
        <Button onClick={onBack} type="button" variant="ghost">
          <ArrowLeft className="h-4 w-4" />
          Back to sign in
        </Button>
      </div>
    </div>
  )
}
