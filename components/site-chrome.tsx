"use client"

import { usePathname } from "next/navigation"
import type { ReactNode } from "react"

import { SocialRail } from "@/components/social-rail"

export function SiteChrome({
  children,
  footer,
  header
}: {
  children: ReactNode
  footer: ReactNode
  header: ReactNode
}) {
  const pathname = usePathname()

  // /account and its sub-pages use their own focused layout — no global chrome.
  const isAuthPage = pathname === "/account" || pathname.startsWith("/account/")

  // Homepage hero is full-viewport with the fixed nav floating over it
  // (matches the mockup). Other pages get top padding so content clears the nav.
  const isHome = pathname === "/"
  const mainPadding = isAuthPage ? "" : isHome ? "" : "pt-20"

  return (
    <>
      {isAuthPage ? null : header}
      <main className={`min-h-screen ${mainPadding}`}>{children}</main>
      {isAuthPage ? null : <SocialRail />}
      {isAuthPage ? null : footer}
    </>
  )
}
