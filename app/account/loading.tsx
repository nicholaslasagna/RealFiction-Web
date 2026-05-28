import Image from "next/image"

export default function AccountLoading() {
  return (
    <section className="relative isolate min-h-screen overflow-hidden">
      <div className="absolute inset-0 -z-30">
        <Image
          alt=""
          aria-hidden="true"
          src="/images/hero2.png"
          fill
          priority
          className="scale-105 object-cover opacity-44 blur-[2px]"
          sizes="100vw"
        />
      </div>
      <div className="absolute inset-0 -z-20 bg-background" />
      <div className="pixel-grid opacity-30" />

      <div className="container-shell flex min-h-screen items-center justify-center py-10">
        <div className="minecraft-panel w-full max-w-xl rounded-lg p-8 text-center">
          <Image
            alt="RealFiction"
            src="/images/logo1.png"
            width={190}
            height={60}
            className="mx-auto drop-shadow-[0_6px_24px_rgba(20,20,19,0.08)]"
          />
          <div className="mx-auto mt-8 h-3 w-40 animate-pulse rounded-full bg-primary/10" />
          <p className="mt-5 text-sm font-semibold text-primary">Loading your RealFiction account...</p>
        </div>
      </div>
    </section>
  )
}
