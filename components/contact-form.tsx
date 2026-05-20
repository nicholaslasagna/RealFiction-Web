"use client"

import { Send } from "lucide-react"
import { FormEvent, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

export function ContactForm() {
  const [status, setStatus] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setStatus("Sending...")

    const form = event.currentTarget
    const formData = new FormData(form)

    const response = await fetch("/api/contact", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(Object.fromEntries(formData))
    })

    const json = (await response.json()) as { message?: string; error?: string }
    setStatus(json.message ?? json.error ?? "Request received.")

    if (response.ok) {
      form.reset()
    }
  }

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <div aria-hidden="true" className="absolute left-[-9999px] top-[-9999px] h-0 w-0 overflow-hidden">
        <label>
          Do not fill this field
          <input autoComplete="off" name="website" tabIndex={-1} />
        </label>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-2 text-sm font-medium">
          Name
          <Input name="name" placeholder="Your name" required />
        </label>
        <label className="grid gap-2 text-sm font-medium">
          Email
          <Input name="email" placeholder="you@example.com" required type="email" />
        </label>
      </div>
      <label className="grid gap-2 text-sm font-medium">
        Minecraft username
        <Input name="minecraftUsername" placeholder="Optional" />
      </label>
      <label className="grid gap-2 text-sm font-medium">
        Topic
        <Input name="topic" placeholder="Billing, account link, appeal, partnership, support" required />
      </label>
      <label className="grid gap-2 text-sm font-medium">
        Message
        <Textarea name="message" placeholder="Include order IDs, usernames, and screenshots links when relevant." required />
      </label>
      <Button className="w-full md:w-fit" type="submit">
        <Send className="h-4 w-4" />
        Send request
      </Button>
      {status ? <p className="text-sm text-muted-foreground">{status}</p> : null}
    </form>
  )
}
