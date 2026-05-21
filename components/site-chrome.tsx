"use client"

import { usePathname } from "next/navigation"
import type { ReactNode } from "react"

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
  // /account and its sub-pages (settings, reset-password) use their own focused
  // layout, so the global header/footer are hidden there.
  const isAuthPage = pathname === "/account" || pathname.startsWith("/account/")

  return (
    <>
      {isAuthPage ? null : header}
      <main className={isAuthPage ? "min-h-screen" : "min-h-screen pt-20"}>{children}</main>
      {isAuthPage ? null : footer}
    </>
  )
}
