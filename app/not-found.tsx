import Link from "next/link"

import { Button } from "@/components/ui/button"

export default function NotFound() {
  return (
    <section className="container-shell flex min-h-[70vh] flex-col items-start justify-center gap-5">
      <p className="minecraft-font text-sm text-primary">404</p>
      <h1 className="display-font max-w-2xl text-5xl font-semibold">This portal is not on the network.</h1>
      <p className="max-w-xl text-muted-foreground">
        The page may have moved during the platform migration. Head back to the RealFiction home base.
      </p>
      <Button asChild>
        <Link href="/">Return home</Link>
      </Button>
    </section>
  )
}
