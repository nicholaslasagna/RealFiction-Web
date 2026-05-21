"use client"

import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Menu, ShieldCheck, X } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { navItems } from "@/lib/data"
import { cn } from "@/lib/utils"

export function SiteHeader() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  return (
    <header className="fixed left-0 right-0 top-0 z-50 border-b border-amber-200/10 bg-[#071525]/88 shadow-[0_12px_40px_rgba(0,0,0,0.35)] backdrop-blur-xl">
      <div className="container-shell flex h-20 items-center justify-between gap-5">
        <Link className="mr-3 flex shrink-0 items-center gap-3" href="/" onClick={() => setOpen(false)}>
          <Image
            alt="RealFiction"
            src="/images/logo1.png"
            width={186}
            height={58}
            priority
            className="drop-shadow-[0_10px_24px_rgba(0,0,0,0.45)]"
          />
          <div className="hidden xl:block">
            <div className="display-font text-lg font-semibold leading-none text-white">RealFiction</div>
            <div className="mt-1 flex items-center gap-1.5 whitespace-nowrap text-xs text-amber-100/70">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-300" />
              Community Minecraft network
            </div>
          </div>
        </Link>

        <nav className="hidden items-center gap-1 xl:flex">
          {navItems.map((item) => {
            const active =
              item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-md px-3 py-2 text-sm font-bold uppercase tracking-[0.08em] text-slate-300 transition hover:bg-amber-200/10 hover:text-amber-100",
                  active && "bg-amber-200/12 text-amber-100"
                )}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="hidden items-center gap-2 xl:flex">
          <Button asChild variant="outline" size="sm">
            <Link href="/account">Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/store">Store</Link>
          </Button>
        </div>

        <Button
          aria-label={open ? "Close navigation" : "Open navigation"}
          className="xl:hidden"
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
          </nav>
        </div>
      ) : null}
    </header>
  )
}
