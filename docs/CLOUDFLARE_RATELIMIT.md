# Cloudflare Rate Limiting And Abuse Deployment Checklist

Edge rate limiting is defense-in-depth in front of the Worker. Every route is
still server-authoritative and verifies its own auth/signatures; these rules
exist to blunt brute force, scraping, and cost-amplification before requests
reach the origin. Configure these in the Cloudflare dashboard (Security → WAF →
Rate limiting rules) or via the Cloudflare API/Terraform. They are not part of
`wrangler.toml`.

## Per-route rules

Counter key is the client IP unless noted. Tune thresholds against real traffic.

| Route | Method | Suggested limit | Action | Why |
| --- | --- | --- | --- | --- |
| `/api/store/checkout` | POST | 10 / min, 100 / hr | Managed Challenge then Block | Each call creates a pending order + provider session; spam is costly. |
| `/api/store/paypal/capture` | GET | 20 / min | Block | Return URL; should only be hit once per checkout. |
| `/api/account/link/start` | POST | 10 / min, 60 / hr | Block | Authenticated, but cheap to spam to mint verification codes. |
| `/api/vote` | POST | 60 / min | Block | Shared-secret protected; prefer allowlisting vote-provider source IPs. |
| `/api/contact` | POST | 5 / 10 min | Block | App enforces the same DB-backed limit; this is a backstop. |
| `/api/plugin/*` | POST | 600 / min per server | Block | HMAC protected; pair with a source-IP allowlist for the game servers. |
| `/api/player-count` | GET | 120 / min | Managed Challenge | Public; protect the upstream status provider. |

## Do not aggressively rate-limit webhooks

`/api/webhooks/stripe` and `/api/webhooks/paypal` must stay reachable for
provider retries. Do not challenge or block them by volume. Instead:

- Allowlist Stripe and PayPal webhook source IP ranges (published by each
  provider) and drop everything else at the WAF.
- Rely on the in-app signature verification (already enforced) for authenticity.
- Keep a generous ceiling (e.g. 1000 / min) only as a last-resort flood guard.

## WAF / source-IP allowlists

- `/api/plugin/*`: create a WAF custom rule that blocks requests whose source IP
  is not in the RealFiction game-server egress allowlist. HMAC already gates
  these, but an IP allowlist removes the entire unauthenticated attack surface.
- Webhooks: allowlist provider IP ranges as above.

## Bot and challenge layer

- Enable Bot Fight Mode (or Super Bot Fight Mode) for the zone.
- Consider Turnstile on the store checkout and contact form for an additional
  human-verification signal if abuse appears.

## Caching and method hygiene

- Confirm all `/api/*` routes are excluded from caching (they are dynamic edge
  functions; no Cache Rule should match them).
- Add a WAF rule to drop disallowed methods per route (e.g. anything other than
  POST on webhook/plugin endpoints, GET on `/api/store/paypal/capture`).

## Post-deploy verification

- Exceed each threshold from a test IP and confirm the configured action fires.
- Confirm a legitimate Stripe/PayPal webhook replay is never challenged.
- Confirm `/api/plugin/*` from a non-allowlisted IP is blocked even with a valid
  body, and from an allowlisted IP with valid HMAC succeeds.
- Confirm normal store/vote/contact flows are unaffected at expected volumes.
