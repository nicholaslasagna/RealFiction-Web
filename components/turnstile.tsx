"use client"

import { useEffect, useRef } from "react"

type TurnstileApi = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string
  remove: (id: string) => void
  reset: (id?: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

// Cloudflare's documented local test key. Never use it in production because
// the widget displays a "testing only" warning to visitors.
const TEST_SITE_KEY = "1x00000000000000000000AA"

export function Turnstile({
  onToken,
  className
}: {
  onToken: (token: string | null) => void
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)
  const siteKey =
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ||
    (process.env.NODE_ENV === "production" ? "" : TEST_SITE_KEY)

  useEffect(() => {
    if (!siteKey) {
      onToken(null)
      return
    }

    let cancelled = false
    const scriptSrc = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"

    function renderWidget() {
      if (cancelled || widgetIdRef.current || !containerRef.current || !window.turnstile) {
        return
      }

      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        theme: "dark",
        size: "flexible",
        "response-field": false,
        callback: (token: string) => onToken(token),
        "expired-callback": () => onToken(null),
        "error-callback": () => onToken(null)
      })
    }

    if (window.turnstile) {
      renderWidget()
    } else {
      let script = document.querySelector<HTMLScriptElement>(
        'script[src^="https://challenges.cloudflare.com/turnstile"]'
      )

      if (!script) {
        script = document.createElement("script")
        script.src = scriptSrc
        script.async = true
        script.defer = true
        document.head.appendChild(script)
      }

      script.addEventListener("load", renderWidget)
    }

    return () => {
      cancelled = true
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current)
        } catch {
          // widget already gone
        }
        widgetIdRef.current = null
      }
    }
  }, [onToken, siteKey])

  if (!siteKey) {
    return (
      <div className={className}>
        <div className="rounded-md border border-border bg-secondary px-4 py-3 text-center text-sm text-muted-foreground">
          Cloudflare check is being set up.
        </div>
      </div>
    )
  }

  return <div ref={containerRef} className={className} />
}
