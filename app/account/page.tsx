import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { ArrowLeft, ShieldCheck } from "lucide-react"

import { AccountAuthCard } from "@/components/account-auth-card"

export const metadata: Metadata = {
  title: "Sign In",
  description:
    "Sign in or create a RealFiction account for Minecraft linking, cosmetics, purchases, voting rewards, and support."
}

export default function AccountPage() {
  return (
    <section className="relative isolate min-h-screen overflow-hidden">
      <div className="absolute inset-0 -z-30">
        <Image
          alt="RealFiction Minecraft background"
          src="/images/hero2.png"
          fill
          priority
          className="scale-105 object-cover opacity-44 blur-[2px]"
          sizes="100vw"
        />
      </div>
      <div className="absolute inset-0 -z-20 bg-[radial-gradient(circle_at_50%_46%,rgba(242,198,109,0.18),transparent_27rem),radial-gradient(circle_at_70%_72%,rgba(129,55,116,0.38),transparent_36rem),linear-gradient(135deg,rgba(6,16,28,0.82),rgba(42,21,55,0.78),rgba(6,16,28,0.94))]" />
      <div className="pixel-grid opacity-30" />

      <div className="container-shell flex min-h-screen flex-col">
        <header className="flex h-24 items-center justify-between gap-4">
          <Link className="flex items-center gap-3" href="/">
            <Image
              alt="RealFiction"
              src="/images/logo1.png"
              width={174}
              height={54}
              className="drop-shadow-[0_12px_28px_rgba(0,0,0,0.5)]"
            />
          </Link>
          <Link
            className="inline-flex items-center gap-2 rounded-md border border-white/12 bg-black/24 px-3 py-2 text-sm font-semibold text-muted-foreground backdrop-blur transition hover:border-amber-200/35 hover:text-amber-100"
            href="/"
          >
            <ArrowLeft className="h-4 w-4" />
            Home
          </Link>
        </header>

        <div className="grid flex-1 place-items-center py-8">
          <div className="w-full">
            <div className="mx-auto mb-5 flex w-fit items-center gap-2 rounded-md border border-emerald-300/18 bg-black/28 px-3 py-2 text-xs font-semibold text-emerald-100 backdrop-blur">
              <ShieldCheck className="h-3.5 w-3.5" />
              Secure RealFiction account
            </div>
            <AccountAuthCard />
          </div>
        </div>
      </div>
    </section>
  )
}
