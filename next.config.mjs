/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lets a dev server run beside the two built servers the browser suite starts,
  // instead of contending with them over `.next`. Unset everywhere else.
  distDir: process.env.RF_DIST_DIR || ".next",
  images: {
    unoptimized: true
  },
  /**
   * Security headers.
   *
   * There were none. That is not itself an exploit, but it removes the browser
   * from the defence: nothing stopped the site being framed, and any future
   * HTML-injection bug had no second line of defence.
   *
   * CSP IS DELIBERATELY NARROW HERE
   * ===============================
   * A full script-src policy is not applied. Next.js injects inline bootstrap
   * scripts, and without per-request nonces (which need middleware and would
   * make every page dynamic) a script-src policy either breaks the app or has
   * to include 'unsafe-inline', which buys nothing. So this sets the parts that
   * are unambiguously safe and genuinely useful, and `frame-ancestors` — which
   * is the one CSP directive that cannot be expressed any other way and is not
   * affected by inline scripts.
   *
   * Verified against the full browser suite rather than assumed compatible.
   */
  async headers() {
    const base = [
      // Clickjacking. `frame-ancestors` is the modern control; X-Frame-Options
      // is kept for older agents that ignore CSP.
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
      { key: "X-Frame-Options", value: "DENY" },
      // Stops a response being reinterpreted as a different content type, which
      // is how a JSON endpoint becomes a script include.
      { key: "X-Content-Type-Options", value: "nosniff" },
      // Send the origin cross-site, never the path. Order pages and the admin
      // surface have identifiers in their URLs.
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      // Nothing here needs these, and denying them limits what injected script
      // could reach.
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()"
      },
      // HTTPS only. Cloudflare terminates TLS; this stops a downgrade attempt
      // reaching it at all.
      { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }
    ]

    // Duplicate header keys are ambiguous — a browser may honour either copy.
    // Overrides therefore REPLACE the base entry rather than being appended.
    const withOverrides = (...overrides) => [
      ...base.filter((h) => !overrides.some((o) => o.key === h.key)),
      ...overrides
    ]

    const noStore = { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, private" }

    return [
      { source: "/:path*", headers: base },
      {
        // The claim page carries a BEARER SECRET in the URL fragment.
        //
        // A fragment is never sent in a Referer header, so it does not leak
        // that way — but it must also never be written to a shared cache, and
        // no referrer at all is the right posture for a page whose URL is the
        // credential.
        source: "/gift-cards/claim",
        headers: withOverrides({ key: "Referrer-Policy", value: "no-referrer" }, noStore)
      },
      {
        // Staff-only, and never worth caching or indexing.
        source: "/admin/:path*",
        headers: withOverrides(noStore, { key: "X-Robots-Tag", value: "noindex, nofollow" })
      },
      {
        // Authenticated, per-user, financial. Must never be shared-cached.
        source: "/account/:path*",
        headers: withOverrides(noStore)
      },
      {
        // API responses are per-request and frequently per-user.
        source: "/api/:path*",
        headers: withOverrides({ key: "Cache-Control", value: "no-store" })
      }
    ]
  },
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "shop.realfiction.live" }],
        destination: "https://realfiction.live/store",
        permanent: true
      },
      {
        source: "/:path*",
        has: [{ type: "host", value: "store.realfiction.live" }],
        destination: "https://realfiction.live/store",
        permanent: true
      }
    ]
  }
}

export default nextConfig
