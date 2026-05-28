import type { Metadata, Viewport } from "next"
import { Fraunces, Inter, JetBrains_Mono } from "next/font/google"

import "@/app/globals.css"
import { SiteChrome } from "@/components/site-chrome"
import { SiteFooter } from "@/components/site-footer"
import { SiteHeader } from "@/components/site-header"

// Fraunces — Claude's analog to Tiempos / Copernicus (display serif).
// Loaded as a variable font so we can expose opsz + SOFT axes via CSS
// variation settings; weight is selectable across the full 100-900 range.
const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-fraunces",
  axes: ["opsz", "SOFT"]
})

// Inter — analog to Styrene B / Söhne (body sans).
const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
  variable: "--font-inter"
})

// JetBrains Mono — IP chips, code, technical labels.
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--font-jetbrains-mono"
})

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
  themeColor: "#faf9f5",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1
}

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${inter.variable} ${jetbrainsMono.variable}`}
    >
      <body>
        <SiteChrome header={<SiteHeader />} footer={<SiteFooter />}>
          {children}
        </SiteChrome>
      </body>
    </html>
  )
}
