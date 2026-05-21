"use client"

import { KeyRound, Mail, ShieldCheck, Smartphone } from "lucide-react"
import { FormEvent, ReactNode, useEffect, useState } from "react"

import { AccountLinkCard } from "@/components/account-link-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getSupabaseBrowserClient } from "@/lib/supabase/browser"
import { cn } from "@/lib/utils"

type AccountSettingsProps = {
  email: string
  linked: boolean
  minecraftUsername: string | null
  minecraftUuid: string | null
  pendingUsername: string | null
}

type Feedback = { kind: "error" | "success"; text: string } | null

export function AccountSettings({
  email,
  linked,
  minecraftUsername,
  minecraftUuid,
  pendingUsername
}: AccountSettingsProps) {
  return (
    <div className="grid gap-6">
      <EmailSection currentEmail={email} />
      <PasswordSection />
      <MinecraftSection
        linked={linked}
        minecraftUsername={minecraftUsername}
        minecraftUuid={minecraftUuid}
        pendingUsername={pendingUsername}
      />
      <TwoFactorSection />
    </div>
  )
}

function SettingsSection({
  icon: Icon,
  title,
  description,
  children
}: {
  icon: typeof Mail
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="minecraft-card rounded-lg p-6 md:p-7">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-amber-200/16 bg-black/24 text-amber-200">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <h2 className="display-font text-2xl font-semibold text-white">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </section>
  )
}

function FeedbackLine({ feedback }: { feedback: NonNullable<Feedback> }) {
  return (
    <p
      className={cn(
        "rounded-md border p-3 text-sm",
        feedback.kind === "error"
          ? "border-rose-400/25 bg-rose-500/10 text-rose-100"
          : "border-emerald-300/20 bg-emerald-400/10 text-emerald-100"
      )}
    >
      {feedback.text}
    </p>
  )
}

function EmailSection({ currentEmail }: { currentEmail: string }) {
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFeedback(null)
    const next = String(new FormData(event.currentTarget).get("email") ?? "").trim()

    if (!next || next === currentEmail) {
      setFeedback({ kind: "error", text: "Enter a different email address." })
      return
    }

    const supabase = getSupabaseBrowserClient()
    if (!supabase) {
      return
    }

    setBusy(true)
    const { error } = await supabase.auth.updateUser(
      { email: next },
      { emailRedirectTo: `${window.location.origin}/account` }
    )
    setBusy(false)

    if (error) {
      setFeedback({ kind: "error", text: "We could not start the email change. Try again." })
      return
    }
    setFeedback({
      kind: "success",
      text: "Check your new inbox to confirm the change. Your current email stays active until then."
    })
  }

  return (
    <SettingsSection icon={Mail} title="Email" description="Change the email used for sign-in and notifications.">
      <p className="mb-4 text-sm text-muted-foreground">
        Current: <span className="font-semibold text-slate-200">{currentEmail}</span>
      </p>
      <form className="grid gap-3 sm:grid-cols-[1fr_auto]" onSubmit={submit}>
        <Input
          autoComplete="email"
          className="h-12 border-white/10 bg-white/[0.035]"
          name="email"
          placeholder="new@example.com"
          required
          type="email"
        />
        <Button className="h-12" disabled={busy} type="submit">
          {busy ? "Sending..." : "Update email"}
        </Button>
      </form>
      {feedback ? <div className="mt-4"><FeedbackLine feedback={feedback} /></div> : null}
    </SettingsSection>
  )
}

function PasswordSection() {
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFeedback(null)
    const form = new FormData(event.currentTarget)
    const password = String(form.get("password") ?? "")
    const confirm = String(form.get("confirm") ?? "")

    if (password !== confirm) {
      setFeedback({ kind: "error", text: "Those passwords do not match." })
      return
    }

    const supabase = getSupabaseBrowserClient()
    if (!supabase) {
      return
    }

    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)

    if (error) {
      setFeedback({ kind: "error", text: "We could not update your password. Try again." })
      return
    }
    event.currentTarget.reset()
    setFeedback({ kind: "success", text: "Your password has been updated." })
  }

  return (
    <SettingsSection icon={KeyRound} title="Password" description="Set a new password for your account.">
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={submit}>
        <Input
          autoComplete="new-password"
          className="h-12 border-white/10 bg-white/[0.035]"
          minLength={8}
          name="password"
          placeholder="New password"
          required
          type="password"
        />
        <Input
          autoComplete="new-password"
          className="h-12 border-white/10 bg-white/[0.035]"
          minLength={8}
          name="confirm"
          placeholder="Confirm new password"
          required
          type="password"
        />
        <div className="sm:col-span-2">
          <Button className="h-12" disabled={busy} type="submit">
            {busy ? "Saving..." : "Update password"}
          </Button>
        </div>
      </form>
      {feedback ? <div className="mt-4"><FeedbackLine feedback={feedback} /></div> : null}
    </SettingsSection>
  )
}

function MinecraftSection({
  linked,
  minecraftUsername,
  minecraftUuid,
  pendingUsername
}: {
  linked: boolean
  minecraftUsername: string | null
  minecraftUuid: string | null
  pendingUsername: string | null
}) {
  return (
    <SettingsSection
      icon={ShieldCheck}
      title="Minecraft account"
      description="Link or change your Minecraft username. Changing it needs a quick in-game reverify."
    >
      {linked ? (
        <p className="mb-4 text-sm text-muted-foreground">
          Currently linked: <span className="font-semibold text-emerald-200">{minecraftUsername}</span>
          {minecraftUuid ? <span className="block break-all text-xs text-muted-foreground/80">ID: {minecraftUuid}</span> : null}
        </p>
      ) : null}
      <AccountLinkCard
        linked={false}
        minecraftUsername={minecraftUsername}
        minecraftUuid={minecraftUuid}
        pendingUsername={pendingUsername ?? minecraftUsername}
      />
    </SettingsSection>
  )
}

function TwoFactorSection() {
  const [status, setStatus] = useState<"loading" | "off" | "on">("loading")
  const [enrolling, setEnrolling] = useState(false)
  const [factorId, setFactorId] = useState<string | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)

  async function refresh() {
    const supabase = getSupabaseBrowserClient()
    if (!supabase) {
      setStatus("off")
      return
    }
    const { data } = await supabase.auth.mfa.listFactors()
    const verified = data?.totp?.some((factor) => factor.status === "verified")
    setStatus(verified ? "on" : "off")
  }

  useEffect(() => {
    refresh()
  }, [])

  async function startEnroll() {
    setFeedback(null)
    const supabase = getSupabaseBrowserClient()
    if (!supabase) {
      return
    }
    setBusy(true)
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" })
    setBusy(false)
    if (error || !data) {
      setFeedback({ kind: "error", text: "We could not start two-step setup. Try again." })
      return
    }
    setFactorId(data.id)
    setQr(data.totp.qr_code)
    setSecret(data.totp.secret)
    setEnrolling(true)
  }

  async function cancelEnroll() {
    const supabase = getSupabaseBrowserClient()
    if (supabase && factorId) {
      await supabase.auth.mfa.unenroll({ factorId })
    }
    setEnrolling(false)
    setFactorId(null)
    setQr(null)
    setSecret(null)
  }

  async function verifyEnroll(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFeedback(null)
    if (!factorId) {
      return
    }
    const code = String(new FormData(event.currentTarget).get("code") ?? "").trim()
    const supabase = getSupabaseBrowserClient()
    if (!supabase) {
      return
    }
    setBusy(true)
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code })
    setBusy(false)
    if (error) {
      setFeedback({ kind: "error", text: "That code did not match. Try again." })
      return
    }
    setEnrolling(false)
    setFactorId(null)
    setQr(null)
    setSecret(null)
    setStatus("on")
    setFeedback({ kind: "success", text: "Two-step verification is now on." })
  }

  async function disable() {
    setFeedback(null)
    const supabase = getSupabaseBrowserClient()
    if (!supabase) {
      return
    }
    setBusy(true)
    const { data } = await supabase.auth.mfa.listFactors()
    const factors = data?.totp ?? []
    for (const factor of factors) {
      await supabase.auth.mfa.unenroll({ factorId: factor.id })
    }
    setBusy(false)
    setStatus("off")
    setFeedback({ kind: "success", text: "Two-step verification is off." })
  }

  return (
    <SettingsSection
      icon={Smartphone}
      title="Two-step verification"
      description="Protect sign-in with a code from an authenticator app (Google Authenticator, Authy, 1Password)."
    >
      {status === "loading" ? (
        <p className="text-sm text-muted-foreground">Checking...</p>
      ) : enrolling ? (
        <div className="grid gap-4">
          <p className="text-sm text-muted-foreground">
            Scan this with your authenticator app, then enter the 6-digit code to turn it on.
          </p>
          <div className="flex flex-col items-center gap-3 rounded-lg border border-white/10 bg-white p-4">
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt="Authenticator QR code" className="h-44 w-44" src={qr} />
            ) : null}
          </div>
          {secret ? (
            <p className="break-all text-center text-xs text-muted-foreground">
              Manual key: <span className="font-mono text-slate-200">{secret}</span>
            </p>
          ) : null}
          <form className="grid gap-3 sm:grid-cols-[1fr_auto]" onSubmit={verifyEnroll}>
            <Input
              autoComplete="one-time-code"
              className="h-12 border-white/10 bg-white/[0.035] text-center font-mono text-lg tracking-[0.4em]"
              inputMode="numeric"
              maxLength={6}
              name="code"
              pattern="[0-9]*"
              placeholder="000000"
              required
            />
            <Button className="h-12" disabled={busy} type="submit">
              {busy ? "Verifying..." : "Turn on"}
            </Button>
          </form>
          <Button disabled={busy} onClick={cancelEnroll} type="button" variant="ghost">
            Cancel
          </Button>
          {feedback ? <FeedbackLine feedback={feedback} /> : null}
        </div>
      ) : status === "on" ? (
        <div className="grid gap-4">
          <p className="inline-flex w-fit items-center gap-2 rounded-md border border-emerald-300/25 bg-emerald-400/10 px-3 py-2 text-sm font-semibold text-emerald-100">
            <ShieldCheck className="h-4 w-4" /> Two-step verification is on
          </p>
          <Button className="w-fit" disabled={busy} onClick={disable} type="button" variant="outline">
            {busy ? "Turning off..." : "Turn off"}
          </Button>
          {feedback ? <FeedbackLine feedback={feedback} /> : null}
        </div>
      ) : (
        <div className="grid gap-4">
          <Button className="w-fit" disabled={busy} onClick={startEnroll} type="button">
            {busy ? "Starting..." : "Turn on two-step"}
          </Button>
          {feedback ? <FeedbackLine feedback={feedback} /> : null}
        </div>
      )}
    </SettingsSection>
  )
}
