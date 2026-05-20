import type { Metadata } from "next"
import { LifeBuoy, Mail, MessageSquareWarning, ShieldCheck } from "lucide-react"

import { ContactForm } from "@/components/contact-form"
import { Reveal } from "@/components/reveal"
import { Badge } from "@/components/ui/badge"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export const metadata: Metadata = {
  title: "Contact",
  description: "Contact RealFiction support for billing, account linking, moderation, appeals, partnerships, and technical support."
}

export default function ContactPage() {
  return (
    <section className="container-shell py-14">
      <Reveal className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <Badge variant="warning">
            <LifeBuoy className="mr-1.5 h-3.5 w-3.5" />
            Support
          </Badge>
          <h1 className="display-font mt-5 text-5xl font-semibold leading-tight md:text-6xl">Contact RealFiction</h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
            Billing, Minecraft account linking, moderation, appeals, partnership requests, bug reports,
            player safety, and store support flow into a ticket-ready architecture.
          </p>
          <div className="mt-7 grid gap-4">
            {[
              { title: "Support", value: "support@realfiction.live", icon: Mail },
              { title: "Business", value: "business@realfiction.live", icon: ShieldCheck },
              { title: "Urgent security", value: "Use the form with account and order IDs", icon: MessageSquareWarning }
            ].map((item) => {
              const Icon = item.icon

              return (
                <Card key={item.title}>
                  <CardHeader>
                    <Icon className="h-5 w-5 text-primary" />
                    <CardTitle>{item.title}</CardTitle>
                    <CardDescription>{item.value}</CardDescription>
                  </CardHeader>
                </Card>
              )
            })}
          </div>
        </div>

        <div className="premium-surface rounded-lg p-6 md:p-8">
          <ContactForm />
        </div>
      </Reveal>
    </section>
  )
}
