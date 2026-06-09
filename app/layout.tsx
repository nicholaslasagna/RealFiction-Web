import type { Metadata, Viewport } from "next"

import "@/app/globals.css"
import { Seasonal } from "@/components/seasonal"
import { SiteChrome } from "@/components/site-chrome"
import { SiteFooter } from "@/components/site-footer"
import { SiteHeader } from "@/components/site-header"
import { THEME_BOOT_SCRIPT } from "@/lib/holidays"

export const metadata: Metadata = {
  metadataBase: new URL("https://realfiction.live"),
  title: {
    default: "RealFiction | Premium Minecraft Network",
    template: "%s | RealFiction"
  },
  description:
    "RealFiction is a non pay-to-win Minecraft network with SMP, Factions, Arcade, BedWars, Murder Mystery, tournaments, maps, voting, accounts, and cosmetics.",
  openGraph: {
    title: "RealFiction",
  description:
    "A premium Minecraft network for community gameplay, fair cosmetics, voting, maps, accounts, and updates.",
    url: "https://realfiction.live",
    siteName: "RealFiction",
    images: [
      {
        url: "/images/hero1.png",
        width: 1200,
        height: 630,
        alt: "RealFiction Minecraft Network"
      }
    ],
    locale: "en_US",
    type: "website"
  },
  twitter: {
    card: "summary_large_image",
    title: "RealFiction",
    description: "Premium non pay-to-win Minecraft network.",
    images: ["/images/hero1.png"]
  }
}

export const viewport: Viewport = {
  themeColor: "#021429",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1
}

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <Seasonal />
        <SiteChrome header={<SiteHeader />} footer={<SiteFooter />}>
          {children}
        </SiteChrome>
      </body>
    </html>
  )
}
