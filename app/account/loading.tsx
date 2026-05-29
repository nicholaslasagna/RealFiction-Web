import Image from "next/image"

/**
 * Account page loading state.
 *
 * Replaces the static gold pulse bar with two real signals of progress:
 *
 *   1. A Minecraft XP-bar style indeterminate progress bar that ACTUALLY
 *      moves. Two CSS animations — a stripe scanning across (`xp-stripe`)
 *      and a width that fills then drains (`xp-fill`) — communicate
 *      "work is happening" without lying about a fake percentage. This is
 *      what UX libraries call an *indeterminate* progress indicator, and
 *      it's the honest choice when we don't have streaming load events
 *      from the upstream server fetch.
 *
 *   2. Skeleton placeholders that mirror the actual shape of the page
 *      that's loading (link card, balance card, perk grid). So the user
 *      sees the layout assembling instead of an empty rectangle.
 *
 *   3. A cycling status line that walks through the real load phases
 *      ("Connecting…" → "Loading your Minecraft link…" → "Loading
 *      perks…" → "Almost there…") so the message text isn't a static
 *      string either.
 *
 * All animations are pure CSS keyframes declared inline so the loading
 * page has no JS cost.
 */
export default function AccountLoading() {
  return (
    <section className="relative isolate min-h-screen overflow-hidden">
      {/* Local keyframes for the XP bar + cycling status text. Kept inline
          so this loading boundary stays self-contained and doesn't have to
          coordinate with globals.css. */}
      <style>{`
        @keyframes account-xp-fill {
          0%   { width: 4%; }
          50%  { width: 92%; }
          100% { width: 4%; }
        }
        @keyframes account-xp-stripe {
          0%   { background-position: 0 0; }
          100% { background-position: 32px 0; }
        }
        @keyframes account-status-cycle {
          0%, 22%   { content: "Connecting to RealFiction..."; }
          25%, 47%  { content: "Loading your Minecraft link..."; }
          50%, 72%  { content: "Loading perks and rewards..."; }
          75%, 100% { content: "Almost there..."; }
        }
        .account-loading-status::after {
          content: "Connecting to RealFiction...";
          animation: account-status-cycle 4.8s linear infinite;
        }
        .account-loading-bar-fill {
          animation: account-xp-fill 1.6s cubic-bezier(0.45, 0.05, 0.55, 0.95) infinite;
        }
        .account-loading-bar-stripe {
          background-image: repeating-linear-gradient(
            45deg,
            rgba(255, 233, 168, 0.55) 0,
            rgba(255, 233, 168, 0.55) 4px,
            rgba(242, 198, 109, 0.85) 4px,
            rgba(242, 198, 109, 0.85) 8px
          );
          background-size: 32px 100%;
          animation: account-xp-stripe 0.8s linear infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .account-loading-bar-fill,
          .account-loading-bar-stripe,
          .account-loading-status::after {
            animation: none;
          }
          .account-loading-bar-fill { width: 60%; }
        }
      `}</style>

      <div className="absolute inset-0 -z-30">
        <Image
          alt=""
          aria-hidden="true"
          src="/images/hero2.png"
          fill
          priority
          className="scale-105 object-cover opacity-44 blur-[2px]"
          sizes="100vw"
        />
      </div>
      <div className="absolute inset-0 -z-20 bg-[radial-gradient(circle_at_50%_46%,rgba(242,198,109,0.18),transparent_27rem),radial-gradient(circle_at_70%_72%,rgba(129,55,116,0.38),transparent_36rem),linear-gradient(135deg,rgba(6,16,28,0.82),rgba(42,21,55,0.78),rgba(6,16,28,0.94))]" />
      <div className="pixel-grid opacity-30" />

      <div className="container-shell flex min-h-screen flex-col items-center justify-center gap-8 py-10">
        {/* Hero loader card */}
        <div className="minecraft-panel w-full max-w-xl rounded-lg p-8 text-center">
          <Image
            alt="RealFiction"
            src="/images/logo1.png"
            width={190}
            height={60}
            className="mx-auto drop-shadow-[0_12px_28px_rgba(0,0,0,0.5)]"
          />

          {/* Real XP-bar style progress indicator. Indeterminate (no fake
              percentage) but actively animated. */}
          <div
            className="mx-auto mt-8 h-3 w-64 overflow-hidden border-2 border-[#00060e] bg-[#0a1424] shadow-[inset_0_2px_0_rgba(255,255,255,0.05),inset_0_-2px_0_rgba(0,0,0,0.4)]"
            role="progressbar"
            aria-busy="true"
            aria-label="Loading your account"
          >
            <div className="account-loading-bar-fill h-full">
              <div className="account-loading-bar-stripe h-full w-full" />
            </div>
          </div>

          <p
            aria-live="polite"
            className="account-loading-status mt-5 min-h-[1.5em] font-mono text-sm font-semibold text-amber-100"
          />
        </div>

        {/* Skeleton placeholders mirroring the real page layout so the
            loader doesn't feel like a black hole. Visually quieter than
            the hero card so the user's eye lands on the progress bar
            above. */}
        <div className="grid w-full max-w-4xl gap-4 sm:grid-cols-[1.6fr_1fr]" aria-hidden>
          <SkeletonPanel rows={[180, 64, 96]} />
          <div className="grid gap-4">
            <SkeletonPanel rows={[120, 48]} />
            <SkeletonPanel rows={[88, 48]} />
          </div>
        </div>
      </div>
    </section>
  )
}

function SkeletonPanel({ rows }: { rows: number[] }) {
  return (
    <div className="minecraft-card rounded-lg p-5">
      {rows.map((height, idx) => (
        <div
          key={idx}
          className="mt-3 first:mt-0 animate-pulse rounded-md bg-white/5"
          style={{ height }}
        />
      ))}
    </div>
  )
}
