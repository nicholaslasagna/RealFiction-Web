"use client"

import { Check, Copy } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"

/**
 * Hero "Copy Java IP" CTA. Uses the gold mc-button variant to match the
 * mockup exactly (gold bg, dark text, white text-shadow).
 */
export function CopyServerButton({
  value = "realfiction.live",
  label = "Copy Java IP"
}: {
  value?: string
  label?: string
}) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <Button onClick={copy} variant="gold" type="button">
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      {copied ? "Copied!" : label}
    </Button>
  )
}
