"use client"

import Image from "next/image"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { ChevronDown, LogOut, Menu, UserRound, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { navItems } from "@/lib/data"
import { getSupabaseBrowserClient } from "@/lib/supabase/browser"
import { cn } from "@/lib/utils"

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

  return (
    <header className="fixed left-0 right-0 top-0 z-50 border-b border-amber-200/10 bg-[#071525]/88 shadow-[0_12px_40px_rgba(0,0,0,0.35)] backdrop-blur-xl">
      <div className="container-shell flex h-20 items-center gap-4">
        <Link className="flex shrink-0 items-center" href="/" onClick={() => setOpen(false)}>
          <Image
            alt="RealFiction"
            src="/images/logo1.png"
            width={186}
            height={58}
            priority
            className="h-12 w-auto drop-shadow-[0_10px_24px_rgba(0,0,0,0.45)]"
          />
        </Link>

        <nav className="hidden flex-1 items-center justify-center gap-0.5 xl:flex">
          {navItems.map((item) => {
            const active =
              item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-md px-2.5 py-2 text-sm font-bold uppercase tracking-[0.04em] text-slate-300 transition hover:bg-amber-200/10 hover:text-amber-100",
                  active && "bg-amber-200/12 text-amber-100"
                )}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="hidden shrink-0 items-center gap-2 xl:flex">
          {signedIn ? (
            <div className="relative" ref={accountRef}>
              <Button variant="outline" size="sm" onClick={() => setAccountOpen((value) => !value)}>
                <UserRound className="h-4 w-4" />
                Account
                <ChevronDown className={cn("h-3.5 w-3.5 transition", accountOpen && "rotate-180")} />
              </Button>
              {accountOpen ? (
                <div className="absolute right-0 mt-2 w-60 overflow-hidden rounded-md border border-amber-200/15 bg-[#0a1726] shadow-2xl">
                  {email ? (
                    <div className="border-b border-white/10 px-3 py-2.5 text-xs text-muted-foreground">
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
            <Button asChild variant="outline" size="sm">
              <Link href="/account">Sign in</Link>
            </Button>
          )}
          <Button asChild size="sm">
            <Link href="/store">Store</Link>
          </Button>
        </div>

        <Button
          aria-label={open ? "Close navigation" : "Open navigation"}
          className="ml-auto xl:hidden"
          onClick={() => setOpen((value) => !value)}
          size="icon"
          variant="outline"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
      </div>

      {open ? (
        <div className="border-t border-amber-200/10 bg-[#071525]/96 xl:hidden">
          <nav className="container-shell grid gap-1 py-4">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-3 text-sm font-bold uppercase tracking-[0.08em] text-slate-300 hover:bg-amber-200/10 hover:text-amber-100"
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
                    className="rounded-md px-3 py-3 text-sm font-bold uppercase tracking-[0.08em] text-slate-300 hover:bg-amber-200/10 hover:text-amber-100"
                  >
                    Account
                  </Link>
                  <Link
                    href="/account/settings"
                    onClick={() => setOpen(false)}
                    className="rounded-md px-3 py-3 text-sm font-bold uppercase tracking-[0.08em] text-slate-300 hover:bg-amber-200/10 hover:text-amber-100"
                  >
                    Settings
                  </Link>
                  <button
                    type="button"
                    onClick={signOut}
                    className="flex items-center gap-2 rounded-md px-3 py-3 text-left text-sm font-bold uppercase tracking-[0.08em] text-slate-300 hover:bg-amber-200/10 hover:text-amber-100"
                  >
                    <LogOut className="h-4 w-4" />
                    Sign out
                  </button>
                </>
              ) : (
                <Link
                  href="/account"
                  onClick={() => setOpen(false)}
                  className="rounded-md px-3 py-3 text-sm font-bold uppercase tracking-[0.08em] text-slate-300 hover:bg-amber-200/10 hover:text-amber-100"
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
