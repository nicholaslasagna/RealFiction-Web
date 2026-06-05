"use client"

import { Send } from "lucide-react"
import { FormEvent, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

export function ContactForm() {
  const [status, setStatus] = useState<string | null>(null)
  const [isError, setIsError] = useState(false)
  const [sending, setSending] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    setSending(true)
    setIsError(false)
    setStatus("Sending…")

    try {
      const formData = new FormData(form)
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(Object.fromEntries(formData))
      })

      const json = (await response.json().catch(() => ({}))) as { message?: string; error?: string }

      if (response.ok) {
        setIsError(false)
        setStatus(json.message ?? "Support request received. Our team will follow up by email.")
        form.reset()
      } else {
        setIsError(true)
        setStatus(json.error ?? "We couldn't send that. Please check the form and try again.")
      }
    } catch {
      setIsError(true)
      setStatus("Network error — please check your connection and try again.")
    } finally {
      setSending(false)
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
          <Input name="name" placeholder="Your name" required minLength={2} maxLength={80} />
        </label>
        <label className="grid gap-2 text-sm font-medium">
          Email
          <Input name="email" placeholder="you@example.com" required type="email" maxLength={160} />
        </label>
      </div>
      <label className="grid gap-2 text-sm font-medium">
        Minecraft username
        <Input name="minecraftUsername" placeholder="Optional" maxLength={16} />
      </label>
      <label className="grid gap-2 text-sm font-medium">
        Topic
        <Input
          name="topic"
          placeholder="Billing, account link, appeal, partnership, support"
          required
          minLength={3}
          maxLength={120}
        />
      </label>
      <label className="grid gap-2 text-sm font-medium">
        Message
        <Textarea
          name="message"
          placeholder="Include order IDs, usernames, and screenshot links when relevant."
          required
          minLength={10}
          maxLength={4000}
          rows={6}
        />
        <span className="text-xs font-normal text-muted-foreground">
          Please include at least 10 characters so we can help.
        </span>
      </label>
      <Button className="w-full md:w-fit" type="submit" disabled={sending}>
        <Send className="h-4 w-4" />
        {sending ? "Sending…" : "Send request"}
      </Button>
      {status ? (
        <p
          className={`text-sm ${isError ? "text-rose-300" : "text-muted-foreground"}`}
          role="status"
          aria-live="polite"
        >
          {status}
        </p>
      ) : null}
    </form>
  )
}
