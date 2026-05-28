"use client"

import Image from "next/image"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { ChevronDown, LogOut, Menu, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { navItems } from "@/lib/data"
import { getSupabaseBrowserClient } from "@/lib/supabase/browser"
import { cn } from "@/lib/utils"

/**
 * Mockup-styled nav (.rf-nav class):
 *   - Fixed top, dark transparent bg with backdrop blur
 *   - Logo on the left (56px tall)
 *   - Uppercase rf-bold nav links, gold on active/hover
 *   - Sign in / Store CTA on the right (mc-button styling)
 *   - Mobile hamburger with collapsible nav
 */
export function SiteHeader() {
  const pathname = usePathname()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  const [email, setEmail] = useState<string | null>(null)
  const accountRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const supabase = getSupabaseBrowserClient()
    if (!supabase) {
      return
    }

    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (!active) {
        return
      }
      setSignedIn(Boolean(data.session))
      setEmail(data.session?.user?.email ?? null)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(Boolean(session))
      setEmail(session?.user?.email ?? null)
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (accountRef.current && !accountRef.current.contains(event.target as Node)) {
        setAccountOpen(false)
      }
    }

    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [])

  async function signOut() {
    const supabase = getSupabaseBrowserClient()
    await supabase?.auth.signOut()
    setAccountOpen(false)
    setOpen(false)
    router.refresh()
  }

  // Lock body scroll while the mobile menu is open, and close it on Esc.
  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("keydown", onKey)
    return () => {
      document.body.style.overflow = previous
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  // Close the menu on route change so navigation feels responsive.
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  return (
    <header className="rf-nav">
      <Link className="logo flex shrink-0 items-center" href="/" onClick={() => setOpen(false)}>
        <Image
          alt="RealFiction"
          src="/images/logo1.png"
          width={186}
          height={58}
          priority
        />
      </Link>

      <ul className="hidden xl:flex">
        {navItems.map((item) => {
          const active =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cn(active && "active")}
              >
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>

      <div className="hidden shrink-0 items-center gap-2 xl:flex">
        {signedIn ? (
          <div className="relative" ref={accountRef}>
            <button
              type="button"
              onClick={() => setAccountOpen((value) => !value)}
              className="inline-flex items-center gap-2 border border-amber-200/30 bg-amber-200/8 px-3 py-2 text-xs uppercase tracking-[0.05em] text-amber-100 transition hover:bg-amber-200/15"
              style={{ fontFamily: "rf-bold, sans-serif" }}
            >
              Account
              <ChevronDown className={cn("h-3.5 w-3.5 transition", accountOpen && "rotate-180")} />
            </button>
            {accountOpen ? (
              <div className="absolute right-0 mt-2 w-60 overflow-hidden border border-amber-200/15 bg-[#062038] shadow-2xl">
                {email ? (
                  <div className="border-b border-white/10 px-3 py-2.5 text-xs text-slate-400">
                    Signed in as
                    <div className="truncate text-slate-200">{email}</div>
                  </div>
                ) : null}
                <Link
                  href="/account"
                  onClick={() => setAccountOpen(false)}
                  className="block px-3 py-2.5 text-sm text-slate-200 transition hover:bg-amber-200/10 hover:text-amber-100"
                >
                  Account
                </Link>
                <Link
                  href="/account/settings"
                  onClick={() => setAccountOpen(false)}
                  className="block px-3 py-2.5 text-sm text-slate-200 transition hover:bg-amber-200/10 hover:text-amber-100"
                >
                  Settings
                </Link>
                <button
                  type="button"
                  onClick={signOut}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-slate-200 transition hover:bg-amber-200/10 hover:text-amber-100"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <Link
            href="/account"
            className="inline-flex items-center border border-amber-200/30 bg-amber-200/8 px-3 py-2 text-xs uppercase tracking-[0.05em] text-amber-100 transition hover:bg-amber-200/15"
            style={{ fontFamily: "rf-bold, sans-serif" }}
          >
            Sign in
          </Link>
        )}
        <Link href="/store" className="mc-button mc-button--gold mc-button--sm">
          Store
        </Link>
      </div>

      {/* Mobile hamburger toggle — visible below xl (under 1280px) */}
      <button
        type="button"
        aria-label={open ? "Close navigation" : "Open navigation"}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="ml-auto inline-flex h-11 w-11 items-center justify-center border border-amber-200/30 bg-amber-200/8 text-amber-100 transition hover:bg-amber-200/15 xl:hidden"
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {/* Mobile menu — opens directly below the nav. Body scroll is locked
          while open, Esc + route change both close it. */}
      {open ? (
        <div
          className="absolute left-0 right-0 top-full border-t border-amber-200/10 bg-[#021429]/97 xl:hidden"
          style={{ maxHeight: "calc(100vh - 80px)", overflowY: "auto" }}
        >
          <nav className="grid gap-1 px-5 py-4">
            {/* Yellow Store CTA pinned to the top of the mobile menu so
                phone visitors don't lose access when the desktop right-
                side Store button is hidden. */}
            <Link
              href="/store"
              onClick={() => setOpen(false)}
              className="mc-button mc-button--gold"
              style={{ justifyContent: "center", marginBottom: 8 }}
            >
              Store
            </Link>

            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="px-3 py-3 text-sm font-bold uppercase tracking-[0.08em] text-slate-300 hover:bg-amber-200/10 hover:text-amber-100"
                style={{ fontFamily: "rf-bold, sans-serif" }}
              >
                {item.label}
              </Link>
            ))}

            <div className="mt-2 grid gap-1 border-t border-amber-200/10 pt-3">
              {signedIn ? (
                <>
                  <Link
                    href="/account"
                    onClick={() => setOpen(false)}
                    className="px-3 py-3 text-sm font-bold uppercase tracking-[0.08em] text-slate-300 hover:bg-amber-200/10 hover:text-amber-100"
                    style={{ fontFamily: "rf-bold, sans-serif" }}
                  >
                    Account
                  </Link>
                  <Link
                    href="/account/settings"
                    onClick={() => setOpen(false)}
                    className="px-3 py-3 text-sm font-bold uppercase tracking-[0.08em] text-slate-300 hover:bg-amber-200/10 hover:text-amber-100"
                    style={{ fontFamily: "rf-bold, sans-serif" }}
                  >
                    Settings
                  </Link>
                  <button
                    type="button"
                    onClick={signOut}
                    className="flex items-center gap-2 px-3 py-3 text-left text-sm font-bold uppercase tracking-[0.08em] text-slate-300 hover:bg-amber-200/10 hover:text-amber-100"
                    style={{ fontFamily: "rf-bold, sans-serif" }}
                  >
                    <LogOut className="h-4 w-4" />
                    Sign out
                  </button>
                </>
              ) : (
                <Link
                  href="/account"
                  onClick={() => setOpen(false)}
                  className="px-3 py-3 text-sm font-bold uppercase tracking-[0.08em] text-slate-300 hover:bg-amber-200/10 hover:text-amber-100"
                  style={{ fontFamily: "rf-bold, sans-serif" }}
                >
                  Sign in
                </Link>
              )}
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  )
}
