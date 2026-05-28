"use client"

import Link from "next/link"
import { useEffect, useState } from "react"

import { getSupabaseBrowserClient } from "@/lib/supabase/browser"

/**
 * Homepage vote streak card — accurate, signed-in-aware.
 *
 * - Not signed in     → empty blocks + "Sign in to start tracking your streak"
 *                       and the CTA points at /account.
 * - Signed in, no row → 0 filled blocks + "Vote daily to start your streak"
 *                       and the CTA points at /vote.
 * - Signed in + row   → real `current_streak` days from public.vote_streaks
 *                       (the same column the vote webhook writes), with
 *                       progress visualized against the next milestone
 *                       (30-day mark by default). Once a streak is past 30,
 *                       the bar reads as a full row and the copy switches.
 *
 * RLS policy `vote_streaks_owner_read` lets a logged-in user read their own
 * row directly via the browser supabase client, so no extra API route is
 * needed.
 */

type StreakRow = {
  current_streak: number
  longest_streak: number
  monthly_votes: number
  total_votes: number
}

const TARGET_DAYS = 30

type State =
  | { kind: "loading" }
  | { kind: "signedOut" }
  | { kind: "signedInNoStreak" }
  | { kind: "signedIn"; streak: StreakRow }

export function HomeVoteStreak() {
  const [state, setState] = useState<State>({ kind: "loading" })

  useEffect(() => {
    let active = true

    async function load() {
      const supabase = getSupabaseBrowserClient()
      if (!supabase) {
        if (active) setState({ kind: "signedOut" })
        return
      }

      const { data: sessionData } = await supabase.auth.getSession()
      const user = sessionData.session?.user

      if (!user) {
        if (active) setState({ kind: "signedOut" })
        return
      }

      // RLS scopes this query to the signed-in user's own row(s).
      // We pick the most recent month's row.
      const { data, error } = await supabase
        .from("vote_streaks")
        .select("current_streak, longest_streak, monthly_votes, total_votes")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle<StreakRow>()

      if (!active) return

      if (error || !data) {
        setState({ kind: "signedInNoStreak" })
        return
      }

      setState({ kind: "signedIn", streak: data })
    }

    void load()

    return () => {
      active = false
    }
  }, [])

  const { filled, total, label, foot, ctaHref, ctaLabel } = derive(state)

  return (
    <section className="section-dark">
      <h3 className="section-title">Vote &amp; Earn Rewards</h3>
      <p className="section-kicker">
        Vote daily to help RealFiction grow, build streaks, and earn server-safe rewards
        through your linked Minecraft account.
      </p>

      <div className="streak-card">
        <div>
          <div className="stat-eyebrow" style={{ color: "var(--text-mute)" }}>
            {label}
          </div>
          <div className="streak-blocks" style={{ marginTop: 12 }}>
            {Array.from({ length: filled }).map((_, i) => (
              <span key={i} className="blk" />
            ))}
            {Array.from({ length: Math.max(0, total - filled) }).map((_, i) => (
              <span key={`e${i}`} className="blk empty" />
            ))}
          </div>
          <div
            style={{
              marginTop: 14,
              fontSize: 13,
              color: "var(--text-dim)",
              fontFamily: "rf-light, sans-serif"
            }}
          >
            {foot}
          </div>
        </div>
        <Link className="mc-button" href={ctaHref}>
          {ctaLabel}
        </Link>
      </div>
    </section>
  )
}

function derive(state: State) {
  switch (state.kind) {
    case "loading": {
      return {
        filled: 0,
        total: TARGET_DAYS,
        label: "Your streak · …",
        foot: "Checking your account…",
        ctaHref: "/vote",
        ctaLabel: "Open Voting Hub"
      }
    }

    case "signedOut": {
      return {
        filled: 0,
        total: TARGET_DAYS,
        label: "Your streak · sign in to track",
        foot: "Sign in and link your Minecraft account to start a streak.",
        ctaHref: "/account",
        ctaLabel: "Sign In"
      }
    }

    case "signedInNoStreak": {
      return {
        filled: 0,
        total: TARGET_DAYS,
        label: "Your streak · 0 days",
        foot: "Vote on any RealFiction site today to start your streak.",
        ctaHref: "/vote",
        ctaLabel: "Open Voting Hub"
      }
    }

    case "signedIn": {
      const days = state.streak.current_streak
      const dayWord = days === 1 ? "day" : "days"
      const filled = Math.min(days, TARGET_DAYS)

      const foot =
        days >= TARGET_DAYS
          ? `Past the ${TARGET_DAYS}-day mark — longest streak so far: ${state.streak.longest_streak} ${state.streak.longest_streak === 1 ? "day" : "days"}.`
          : `Reach a ${TARGET_DAYS}-day streak to unlock the next milestone.`

      return {
        filled,
        total: TARGET_DAYS,
        label: `Your streak · ${days} ${dayWord}`,
        foot,
        ctaHref: "/vote",
        ctaLabel: "Open Voting Hub"
      }
    }
  }
}
