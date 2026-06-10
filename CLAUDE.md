# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Family Dinner Planner — a Next.js (App Router) web app that drafts a week of dinners for a 4-person household (favourites + AI suggestions via Vercel AI Gateway), calculates per-person macro targets and portion guidance, and generates a store-section-grouped shopping list.

**Status:** pre-implementation. The approved design spec is `docs/superpowers/specs/2026-06-10-dinner-planner-design.md` and the task-by-task implementation plan is `docs/superpowers/plans/2026-06-11-dinner-planner.md`. Read both before making changes — the spec is the source of truth for behaviour, the plan for structure and task order. Implementation follows the plan via TDD with frequent commits.

## Commands

```bash
npm test                                  # full suite (Vitest: unit + integration)
npx vitest run src/lib/macro/targets.test.ts   # single test file
npm run dev                               # dev server (needs .env.local)
npm run build && npx tsc --noEmit         # production build + type check
npm run db:generate                       # generate drizzle migrations (required before integration tests)
npm run db:push                           # apply schema to Neon
```

Local env lives in `.env.local`: `DATABASE_URL` (Neon), `HOUSEHOLD_PASSWORD`, `AUTH_SECRET`, optional `AI_MODEL`. Tests need none of these — integration tests run on PGlite (in-memory Postgres) and all AI calls are faked.

## Architecture

Single deployable Next.js app on Vercel; Neon Postgres via Drizzle ORM. Three strict layers:

1. **Pure macro engine** (`src/lib/macro/`) — all arithmetic: Mifflin-St Jeor targets, portion solver, weekly tally, ingredient aggregation, AI-output sanity checks. Deterministic, dependency-free, unit-tested. **AI never does arithmetic; this layer never does I/O.**
2. **Services** (`src/lib/services/`, `src/lib/planner/`, `src/lib/ai/`) — orchestration. Services take a `Db` parameter (driver-agnostic type from `src/lib/db`) so the same code runs against Neon in prod and PGlite in tests. AI functions take an injectable generator parameter defaulting to the real AI SDK call — tests pass fakes, never hit live models.
3. **Server actions + pages** (`src/app/`) — thin wrappers: parse `FormData`, call a service with `getDb()`, `revalidatePath`. No business logic here. UI is server components with plain forms; client JS is avoided.

AI calls use AI SDK v6 `generateObject` with Zod schemas through AI Gateway plain model strings (default `anthropic/claude-haiku-4.5`, override with `AI_MODEL`). Every AI recipe is validated in code (kcal ≈ 4·protein + 4·carbs + 9·fat ±15%, allergy re-screen) and silently regenerated once on failure; AI being down must never block planning — fall back to favourites-only and surface a notice.

## Conventions

- **Day indexing: 0 = Monday … 6 = Sunday.** Weeks are identified by `weekStart` (Monday, `YYYY-MM-DD`, UTC).
- Auth is a single shared household password → SHA-256 session cookie checked in `src/middleware.ts`. No per-user accounts.
- A re-plan or day swap invalidates the week's shopping list; manually added list items survive a rebuild.
- Pinned days survive re-planning; AI recipes are persisted to the `recipes` table with `source: 'ai'` so planned dinners always reference a DB row.
