import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { redirect } from "next/navigation"
import { ArrowLeft } from "lucide-react"

import { AccountSettings } from "@/components/account-settings"
import { AccountSignOutButton } from "@/components/account-sign-out-button"
import { createSupabaseServerClient, getAuthenticatedUser } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Account settings",
  robots: { index: false }
}

type MinecraftLink = {
  status: string
  minecraft_username: string | null
  minecraft_uuid: string | null
}

async function getLinks(): Promise<MinecraftLink[]> {
  try {
    const supabase = await createSupabaseServerClient()
    const { data } = await supabase
      .from("minecraft_account_links")
      .select("status,minecraft_username,minecraft_uuid")
      .order("created_at", { ascending: false })
    return (data ?? []) as MinecraftLink[]
  } catch {
    return []
  }
}

export default async function AccountSettingsPage() {
  const user = await getAuthenticatedUser().catch(() => null)

  if (!user) {
    redirect("/account")
  }

  const links = await getLinks()
  const verified = links.find((link) => link.status === "verified")
  const pending = links.find((link) => link.status === "pending")

  return (
    <section className="relative isolate min-h-screen overflow-hidden">
      <div className="absolute inset-0 -z-30">
        <Image
          alt=""
          aria-hidden="true"
          src="/images/hero2.png"
          fill
          priority
          className="scale-105 object-cover opacity-40 blur-[2px]"
          sizes="100vw"
        />
      </div>
      <div className="absolute inset-0 -z-20 bg-background" />

      <div className="container-shell flex min-h-screen flex-col">
        <header className="flex h-24 items-center justify-between gap-4">
          <Link className="flex items-center gap-3" href="/">
            <Image
              alt="RealFiction"
              src="/images/logo1.png"
              width={174}
              height={54}
              className="drop-shadow-[0_6px_24px_rgba(20,20,19,0.08)]"
            />
          </Link>
          <div className="flex items-center gap-2">
            <AccountSignOutButton />
            <Link
              className="inline-flex items-center gap-2 rounded-md border border-border bg-secondary px-3 py-2 text-sm font-semibold text-muted-foreground backdrop-blur transition hover:border-border hover:text-primary"
              href="/account"
            >
              <ArrowLeft className="h-4 w-4" />
              Account
            </Link>
          </div>
        </header>

        <main className="mx-auto w-full max-w-3xl pb-16 pt-2">
          <div className="minecraft-panel rounded-lg p-6 md:p-8">
            <h1 className="display-font text-4xl font-semibold leading-tight text-foreground md:text-5xl">Account settings</h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
              Manage your email, password, two-step verification, and linked Minecraft account.
            </p>
          </div>

          <div className="mt-6">
            <AccountSettings
              email={user.email ?? ""}
              linked={Boolean(verified)}
              minecraftUsername={verified?.minecraft_username ?? null}
              minecraftUuid={verified?.minecraft_uuid ?? null}
              pendingUsername={pending?.minecraft_username ?? null}
            />
          </div>
        </main>
      </div>
    </section>
  )
}
