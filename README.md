# RealFiction Platform

Premium Minecraft network platform for RealFiction.

## Stack

- Next.js App Router
- TypeScript
- TailwindCSS
- Framer Motion
- shadcn-style owned UI primitives
- Cloudflare Workers/OpenNext
- Supabase Auth/PostgreSQL/RLS
- Stripe Checkout and PayPal Checkout route contracts
- RealCore plugin architecture for Minecraft fulfillment
- RealVoteBridge for Velocity NuVotifier vote ingestion

## Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Production Build

```bash
npm run build
npm run build:cloudflare
```

Cloudflare Worker output is configured through `wrangler.toml`. The build step is
`npm run build:cloudflare` (see deploy docs for why `build` stays `next build`).

## Key Docs

- [Architecture](docs/ARCHITECTURE.md)
- [RealCore Plugin](docs/REALCORE_PLUGIN.md)
- [RealVoteBridge](realvotebridge/README.md)
- [Global Economy Foundation](docs/GLOBAL_ECONOMY.md)
- [Migration Roadmap](docs/MIGRATION_ROADMAP.md)
- [Cloudflare Deploy & Env Vars](docs/CLOUDFLARE_DEPLOY.md)
- [Cloudflare Rate Limiting](docs/CLOUDFLARE_RATELIMIT.md)
- [Staging Supabase Checklist](docs/STAGING_SUPABASE_CHECKLIST.md)
- [Supabase migration](supabase/migrations/202605200001_realfiction_platform.sql)

## License

Proprietary — © 2018–2026 RealFiction. All rights reserved. See [LICENSE](LICENSE).
