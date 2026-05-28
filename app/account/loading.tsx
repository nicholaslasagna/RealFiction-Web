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
      <div className="absolute inset-0 -z-20 bg-[radial-gradient(circle_at_50%_46%,rgba(242,198,109,0.18),transparent_27rem),radial-gradient(circle_at_70%_72%,rgba(129,55,116,0.38),transparent_36rem),linear-gradient(135deg,rgba(6,16,28,0.82),rgba(42,21,55,0.78),rgba(6,16,28,0.94))]" />
      <div className="pixel-grid opacity-30" />

      <div className="container-shell flex min-h-screen items-center justify-center py-10">
        <div className="minecraft-panel w-full max-w-xl rounded-lg p-8 text-center">
          <Image
            alt="RealFiction"
            src="/images/logo1.png"
            width={190}
            height={60}
            className="mx-auto drop-shadow-[0_12px_28px_rgba(0,0,0,0.5)]"
          />
          <div className="mx-auto mt-8 h-3 w-40 animate-pulse rounded-full bg-amber-200/30" />
          <p className="mt-5 text-sm font-semibold text-amber-100">Loading your RealFiction account...</p>
        </div>
      </div>
    </section>
  )
}
