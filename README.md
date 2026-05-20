# RealFiction Platform

Premium Minecraft network platform for RealFiction.

## Stack

- Next.js App Router
- TypeScript
- TailwindCSS
- Framer Motion
- shadcn-style owned UI primitives
- Cloudflare Pages/OpenNext
- Supabase Auth/PostgreSQL/RLS
- Stripe Checkout and PayPal Checkout route contracts
- RealCore plugin architecture for Minecraft fulfillment

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

Cloudflare Pages output is configured through `wrangler.toml`.

## Key Docs

- [Architecture](docs/ARCHITECTURE.md)
- [RealCore Plugin](docs/REALCORE_PLUGIN.md)
- [Migration Roadmap](docs/MIGRATION_ROADMAP.md)
- [Supabase migration](supabase/migrations/202605200001_realfiction_platform.sql)
