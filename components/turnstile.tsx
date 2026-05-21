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

// Cloudflare's documented "always passes" test site key. Used only until a real
// NEXT_PUBLIC_TURNSTILE_SITE_KEY is configured, so the widget renders in dev.
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
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || TEST_SITE_KEY

  useEffect(() => {
    let cancelled = false
    const scriptSrc = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"

    function renderWidget() {
      if (cancelled || widgetIdRef.current || !containerRef.current || !window.turnstile) {
        return
      }

      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        theme: "dark",
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

  return <div ref={containerRef} className={className} />
}
