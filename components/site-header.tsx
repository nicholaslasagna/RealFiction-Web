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
    <header className="fixed left-0 right-0 top-0 z-50 border-b border-white/10 bg-background/78 backdrop-blur-xl">
      <div className="container-shell flex h-20 items-center justify-between gap-5">
        <Link className="mr-4 flex shrink-0 items-center gap-3" href="/" onClick={() => setOpen(false)}>
          <Image
            alt="RealFiction"
            src="/images/logo1.png"
            width={152}
            height={48}
            priority
          />
          <div className="hidden sm:block">
            <div className="display-font text-lg font-semibold leading-none">RealFiction</div>
            <div className="mt-1 flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-300" />
              Non pay-to-win network
            </div>
          </div>
        </Link>

        <nav className="hidden items-center gap-1 2xl:flex">
          {navItems.map((item) => {
            const active =
              item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-white/6 hover:text-foreground",
                  active && "bg-white/8 text-foreground"
                )}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="hidden items-center gap-2 2xl:flex">
          <Button asChild variant="outline" size="sm">
            <Link href="/account">Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/store">Store</Link>
          </Button>
        </div>

        <Button
          aria-label={open ? "Close navigation" : "Open navigation"}
          className="2xl:hidden"
          onClick={() => setOpen((value) => !value)}
          size="icon"
          variant="outline"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
      </div>

      {open ? (
        <div className="border-t border-white/10 bg-background/96 2xl:hidden">
          <nav className="container-shell grid gap-1 py-4">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-3 text-sm font-medium text-muted-foreground hover:bg-white/6 hover:text-foreground"
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
