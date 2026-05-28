import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"

import { ResetPasswordForm } from "@/components/reset-password-form"

export const metadata: Metadata = {
  title: "Reset password",
  robots: { index: false }
}

export default function ResetPasswordPage() {
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
      <div className="absolute inset-0 -z-20 bg-[linear-gradient(135deg,rgba(6,16,28,0.86),rgba(42,21,55,0.8),rgba(6,16,28,0.95))]" />

      <div className="container-shell flex min-h-screen flex-col">
        <header className="flex h-24 items-center">
          <Link className="flex items-center gap-3" href="/">
            <Image
              alt="RealFiction"
              src="/images/logo1.png"
              width={174}
              height={54}
              className="drop-shadow-[0_12px_28px_rgba(0,0,0,0.5)]"
            />
          </Link>
        </header>
        <div className="flex flex-1 items-center justify-center py-8">
          <ResetPasswordForm />
        </div>
      </div>
    </section>
  )
}
