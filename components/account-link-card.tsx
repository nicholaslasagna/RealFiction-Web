"use client"

import { Copy, RefreshCw, Unlink } from "lucide-react"
import { FormEvent, useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

/**
 * Minecraft-style pixel "chain link" icon used for the account link
 * status. Replaces the generic shield+check / link-chain lucide icons
 * with something that fits the in-game aesthetic.
 */
function PixelChainIcon({ size = 24, color = "#f2c66d" }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      aria-hidden
    >
      {/* Top link */}
      <rect x="3" y="2" width="4" height="1" fill={color} />
      <rect x="2" y="3" width="1" height="3" fill={color} />
      <rect x="7" y="3" width="1" height="3" fill={color} />
      <rect x="3" y="6" width="4" height="1" fill={color} />
      {/* Bottom link */}
      <rect x="9" y="9" width="4" height="1" fill={color} />
      <rect x="8" y="10" width="1" height="3" fill={color} />
      <rect x="13" y="10" width="1" height="3" fill={color} />
      <rect x="9" y="13" width="4" height="1" fill={color} />
      {/* Connector */}
      <rect x="6" y="6" width="1" height="2" fill={color} />
      <rect x="7" y="7" width="2" height="1" fill={color} />
      <rect x="9" y="8" width="1" height="1" fill={color} />
    </svg>
  )
}

type AccountLinkCardProps = {
  linked: boolean
  minecraftUsername?: string | null
  minecraftUuid?: string | null
  pendingUsername?: string | null
}

type LinkStartResponse = {
  linkRequest?: {
    verificationCode?: string
    command?: string
    expiresAt?: string
  }
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
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const [unlinkConfirm, setUnlinkConfirm] = useState(false)
  const [unlinking, setUnlinking] = useState(false)
  const [unlinkMessage, setUnlinkMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!code || linked) {
      return
    }

    const timer = window.setInterval(() => {
      startTransition(() => router.refresh())
    }, 5000)

    return () => window.clearInterval(timer)
  }, [code, linked, router, startTransition])

  useEffect(() => {
    if (!code || !expiresAt || linked) {
      setSecondsLeft(null)
      return
    }

    const target = new Date(expiresAt).getTime()
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((target - Date.now()) / 1000))
      setSecondsLeft(remaining)
      if (remaining <= 0) {
        setCode(null)
        setCommand(null)
        setExpiresAt(null)
        setMessage("That code expired. Tap Link Account for a fresh one.")
      }
    }

    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [code, expiresAt, linked])

  async function unlinkAccount() {
    setUnlinking(true)
    setUnlinkMessage(null)

    try {
      const response = await fetch("/api/account/link/unlink", { method: "POST" })

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string }
        setUnlinkMessage(data.error ?? "We could not unlink right now. Try again in a moment.")
        return
      }

      setUnlinkConfirm(false)
      startTransition(() => router.refresh())
    } catch {
      setUnlinkMessage("We could not unlink right now. Try again in a moment.")
    } finally {
      setUnlinking(false)
    }
  }

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
      const linkRequest = data.linkRequest

      if (!response.ok || !linkRequest?.verificationCode || !linkRequest?.command) {
        setMessage(data.error ?? "We could not make a link code yet. Try again in a moment.")
        return
      }

      setCode(linkRequest.verificationCode)
      setCommand(linkRequest.command)
      setExpiresAt(linkRequest.expiresAt ?? null)
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
          <div className="flex h-12 w-12 items-center justify-center border-2 border-[#00060e] bg-gradient-to-b from-[#1a2638] to-[#0a1424] shadow-[inset_0_2px_0_rgba(255,255,255,0.08),inset_0_-2px_0_rgba(0,0,0,0.3)]">
            <PixelChainIcon size={24} color="#3eb336" />
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

            <div className="mt-5 border-t border-white/10 pt-4">
              {unlinkConfirm ? (
                <div className="rounded-lg border border-rose-300/20 bg-rose-300/5 p-4">
                  <p className="text-sm leading-6 text-rose-100">
                    Unlink {minecraftUsername}? Your in-game perks come off this account right away. You keep
                    everything you bought — link any account later to use them again.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      className="bg-rose-500/90 text-white hover:bg-rose-500"
                      disabled={unlinking}
                      onClick={unlinkAccount}
                      type="button"
                    >
                      <Unlink className="h-4 w-4" />
                      {unlinking ? "Unlinking..." : "Yes, unlink"}
                    </Button>
                    <Button disabled={unlinking} onClick={() => setUnlinkConfirm(false)} type="button" variant="ghost">
                      Keep linked
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  className="text-muted-foreground hover:text-rose-100"
                  onClick={() => {
                    setUnlinkMessage(null)
                    setUnlinkConfirm(true)
                  }}
                  type="button"
                  variant="ghost"
                >
                  <Unlink className="h-4 w-4" />
                  Unlink this account
                </Button>
              )}

              {unlinkMessage ? (
                <p className="mt-3 rounded-md border border-rose-300/18 bg-rose-300/10 p-3 text-sm text-rose-100">
                  {unlinkMessage}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="minecraft-card rounded-lg p-6">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center border-2 border-[#00060e] bg-gradient-to-b from-[#1a2638] to-[#0a1424] shadow-[inset_0_2px_0_rgba(255,255,255,0.08),inset_0_-2px_0_rgba(0,0,0,0.3)]">
          <PixelChainIcon size={24} color="#f2c66d" />
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
            {secondsLeft !== null ? (
              <span className={cn("font-bold", secondsLeft <= 10 ? "text-rose-200" : "text-amber-100")}>
                Expires in {secondsLeft}s — run it before it disappears.{" "}
              </span>
            ) : null}
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
