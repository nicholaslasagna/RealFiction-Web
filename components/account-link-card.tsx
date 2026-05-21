"use client"

import { Copy, Link2, RefreshCw, ShieldCheck } from "lucide-react"
import { FormEvent, useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type AccountLinkCardProps = {
  linked: boolean
  minecraftUsername?: string | null
  minecraftUuid?: string | null
  pendingUsername?: string | null
}

type LinkStartResponse = {
  verificationCode?: string
  command?: string
  expiresAt?: string
  error?: string
}

export function AccountLinkCard({
  linked,
  minecraftUsername,
  minecraftUuid,
  pendingUsername
}: AccountLinkCardProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [minecraftName, setMinecraftName] = useState(pendingUsername ?? minecraftUsername ?? "")
  const [code, setCode] = useState<string | null>(null)
  const [command, setCommand] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!code || linked) {
      return
    }

    const timer = window.setInterval(() => {
      startTransition(() => router.refresh())
    }, 5000)

    return () => window.clearInterval(timer)
  }, [code, linked, router, startTransition])

  async function startLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setMessage(null)
    setCopied(false)

    try {
      const response = await fetch("/api/account/link/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minecraftUsername: minecraftName, platform: "java" })
      })
      const data = (await response.json()) as LinkStartResponse

      if (!response.ok || !data.verificationCode || !data.command) {
        setMessage(data.error ?? "We could not make a link code yet. Try again in a moment.")
        return
      }

      setCode(data.verificationCode)
      setCommand(data.command)
      setExpiresAt(data.expiresAt ?? null)
      setMessage("Jump in-game and run the command below.")
    } catch {
      setMessage("We could not make a link code yet. Try again in a moment.")
    } finally {
      setBusy(false)
    }
  }

  async function copyCommand() {
    if (!command) {
      return
    }

    await navigator.clipboard.writeText(command)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  if (linked) {
    return (
      <div className="minecraft-card rounded-lg p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-md border border-emerald-300/25 bg-emerald-300/12 text-emerald-200">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-emerald-200">Minecraft linked</p>
            <h2 className="display-font mt-2 text-3xl font-semibold text-white">{minecraftUsername}</h2>
            {minecraftUuid ? (
              <p className="mt-2 break-all text-sm text-muted-foreground">Player ID: {minecraftUuid}</p>
            ) : null}
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              Your rewards and cosmetics can now find you in-game.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="minecraft-card rounded-lg p-6">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-md border border-amber-300/25 bg-amber-300/12 text-amber-200">
          <Link2 className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-amber-200">Link Minecraft</p>
          <h2 className="display-font mt-2 text-3xl font-semibold text-white">Connect your player</h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Get a short code, then run it in Lobby1 to connect your account.
          </p>
        </div>
      </div>

      <form className="mt-6 grid gap-3 sm:grid-cols-[1fr_auto]" onSubmit={startLink}>
        <Input
          autoComplete="username"
          className="h-12 border-white/10 bg-white/[0.035]"
          maxLength={16}
          minLength={3}
          onChange={(event) => setMinecraftName(event.target.value)}
          placeholder="Minecraft username"
          required
          value={minecraftName}
        />
        <Button className="h-12" disabled={busy || !minecraftName.trim()} type="submit">
          {busy ? "Making code..." : "Link Account"}
        </Button>
      </form>

      {command ? (
        <div className="mt-5 rounded-lg border border-amber-200/16 bg-black/28 p-4">
          <p className="text-sm font-bold text-amber-100">Run this in-game:</p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-white/10 bg-[#050914] px-3 py-3 text-sm font-bold text-white">
              {command}
            </code>
            <Button className="shrink-0" onClick={copyCommand} type="button" variant="outline">
              <Copy className="h-4 w-4" />
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            {expiresAt ? `This code lasts a short time. ` : null}
            This page checks for your link automatically.
          </p>
        </div>
      ) : null}

      {message ? (
        <p
          className={cn(
            "mt-4 rounded-md border p-3 text-sm",
            code
              ? "border-emerald-300/18 bg-emerald-300/10 text-emerald-100"
              : "border-amber-300/18 bg-amber-300/10 text-amber-100"
          )}
        >
          {message}
        </p>
      ) : null}

      <Button
        className="mt-4"
        disabled={isPending}
        onClick={() => startTransition(() => router.refresh())}
        type="button"
        variant="ghost"
      >
        <RefreshCw className={cn("h-4 w-4", isPending ? "animate-spin" : null)} />
        Check link status
      </Button>
    </div>
  )
}
