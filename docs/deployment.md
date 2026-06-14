# Deployment Guide

How to take the dinner planner from this repo to a live Vercel + Neon deployment.

---

## Prerequisites

- Vercel account
- Node.js 20+ and npm installed locally
- `openssl` available in terminal

---

## Step 1 — Neon database

Create a free Postgres database at [neon.tech](https://neon.tech) (or via the Vercel Marketplace — easier if you want the connection string auto-populated as a Vercel env var).

Copy the **connection string** — it looks like:
```
postgres://user:password@ep-xxx.us-east-1.aws.neon.tech/neondb?sslmode=require
```

---

## Step 2 — Vercel project

Upgrade the CLI first (the version bundled with the repo is outdated):

```bash
npm i -g vercel@latest
```

Then link this directory to a Vercel project:

```bash
vercel link
```

This creates a project in your Vercel account if one doesn't exist yet.

---

## Step 3 — Environment variables

Add the three required secrets to Vercel:

```bash
vercel env add DATABASE_URL        # paste the Neon connection string
vercel env add HOUSEHOLD_PASSWORD  # the shared password everyone in the household uses
vercel env add AUTH_SECRET         # run: openssl rand -hex 32
```

Then pull all vars into your local `.env.local` (this also provisions `VERCEL_OIDC_TOKEN` for AI Gateway):

```bash
vercel env pull .env.local
```

`VERCEL_OIDC_TOKEN` authenticates AI Gateway calls automatically — no Anthropic API key needed.

---

## Step 4 — Apply schema to Neon

Push the Drizzle schema to your Neon database:

```bash
npm run db:push
```

Expected output: Drizzle reports all 7 tables created (`people`, `recipes`, `week_plans`, `planned_dinners`, `pantry_staples`, `shopping_lists`, `settings`). If prompted about existing tables, choose push.

---

## Step 5 — Enable AI Gateway

In the Vercel dashboard for your project: **Settings → AI → Enable AI Gateway**.

Set a **budget alert** and a **hard monthly cap (~$5)** — the spec requires this. Expected spend is well under $1/month at household scale (~60 recipe generation calls/month using `anthropic/claude-haiku-4.5`).

The model string in the code (`anthropic/claude-haiku-4.5`, overridable via `AI_MODEL` env var) routes through the gateway automatically once it's enabled.

---

## Step 6 — Deploy

```bash
vercel deploy --prod
```

---

## Step 7 — First-run smoke test

Open the production URL and verify:

1. **Auth** — unauthenticated visit redirects to `/login`; entering `HOUSEHOLD_PASSWORD` lands on the Plan page
2. **Family** — add 4 people with profiles; set preferred cuisines (e.g. `indian, mexican, italian`); add a pantry staple (`olive oil`)
3. **Recipes** — add 2–3 favourite dinners with AI macro estimation on
4. **Plan** — "Plan my week" fills 7 days; no same-cuisine nights back-to-back; each card shows portion table
5. **Swap & pin** — swap a day, pin it, re-plan; the pinned day survives
6. **Shopping** — tick any low staples → build list → list is grouped by store section; tick items off

If AI Gateway isn't enabled yet, an amber "favourites only" banner appears and planning still works (graceful degradation).

---

## Updating

Subsequent deploys:

```bash
vercel deploy --prod
```

If the schema changed (new migration in `drizzle/`):

```bash
npm run db:push   # or: npm run db:generate && npm run db:push
```

---

## Deferred / known gaps

| Item | Notes |
|---|---|
| "Pick manually" swap | The `swapDay` service supports `{ recipeId }` mode but no UI picker exists yet |
| `recipes.source` index | Full table scan on plan; not noticeable at household scale |
| N+1 recipe fetches in `getWeek` | 7 individual queries for 7 dinners; easy to batch with `inArray` if latency becomes an issue |
| Per-person notification if portions off-target | Currently shown as a warning label; could email/push in future |
