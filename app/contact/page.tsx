import type { Metadata } from "next"

import { ContactForm } from "@/components/contact-form"
import { BookIcon, EmeraldIcon, SteveHeadIcon } from "@/components/minecraft-icons"
import { Reveal } from "@/components/reveal"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export const metadata: Metadata = {
  title: "Contact",
  description: "Contact RealFiction support for billing, account linking, moderation, appeals, partnerships, and help requests."
}

export default function ContactPage() {
  return (
    <section className="container-shell py-14">
      <Reveal className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <h1 className="display-font text-5xl font-semibold leading-tight md:text-6xl">Contact RealFiction</h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
            Billing, Minecraft account linking, moderation, appeals, partnership requests, bug reports,
            player safety, and store support all reach the RealFiction team here.
          </p>
          <div className="mt-7 grid gap-4">
            {[
              { title: "Support", value: "support@realfiction.live", icon: BookIcon },
              { title: "Business", value: "business@realfiction.live", icon: EmeraldIcon },
              { title: "Account help", value: "Use the form with your username or order ID", icon: SteveHeadIcon }
            ].map((item) => {
              const Icon = item.icon

              return (
                <Card key={item.title} className="minecraft-card">
                  <CardHeader>
                    <Icon size={22} />
                    <CardTitle>{item.title}</CardTitle>
                    <CardDescription>{item.value}</CardDescription>
                  </CardHeader>
                </Card>
              )
            })}
          </div>
        </div>

        <div className="minecraft-panel rounded-lg p-6 md:p-8">
          <ContactForm />
        </div>
      </Reveal>
    </section>
  )
}
