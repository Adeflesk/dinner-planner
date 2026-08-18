# Roadmap — Family Dinner Planner

From the app review of 2026-07-31. This replaces the old `docs/backlog.md`
(2026-07-08), which was deleted when this file was written — every one of its
still-open entries is carried into the lists below, and the rest had shipped.
Larger items still go through the normal brainstorm → spec → plan cycle before
code.

## Where the app stands

Shipped, in order: the core planner (plan/swap/pin, macro engine, shopping
list, auth), edit-family-members, appliance-aware recipes, ingredient canon,
two-week planning window (backlog #1 ✅), mark-as-staple (backlog #2 ✅), and
the recipe detail page with history and editing, recipe deletion
(detail-page delete, past-weeks-deletable rule — PR #8, merged 2026-08-01),
which also fixed the "deleteRecipe silently no-ops" wart from the backlog,
the manual-pick swap (PR #10, merged 2026-08-06), and PWA install
(PR #11, merged 2026-08-18).

Health: 196 tests passing in 22 files; the three-layer architecture (pure
macro engine / Db-injected services / thin server actions) is holding with no
drift observed. Component tests exist as of PR #10
(`@testing-library/react` + jsdom, opted into per file so the PGlite suites
stay on the node environment) — `src/app/(app)/PickerPanel.test.tsx` is the
worked example to copy for any future UI test.

## Done since this roadmap was written

1. ~~**Merge `feature/recipe-deletion`**~~ ✅ PR #8 merged to `master`
   2026-08-01, tests green on the merged result.
2. ~~**Doc hygiene**~~ ✅ CLAUDE.md's "pre-implementation" status replaced
   with the shipped-feature list, a docs map, and the per-feature
   spec → plan → TDD → PR cycle; its stale `src/middleware.ts` reference
   corrected to `src/proxy.ts` (Next.js 16 renamed middleware to proxy);
   `backlog.md` retired in favour of this file.

3. ~~**Spread vegetarian nights**~~ ✅ `vegetarianDays` in
   `src/lib/planner/draft.ts` now buckets the week and draws one night from
   each bucket, over unpinned days only.
4. ~~**`cup` units in the ingredient canon**~~ ✅ curated grams-per-cup table
   for dry staples in `src/lib/macro/canon.ts`; cup and gram lines of the
   same staple now merge.
5. ~~**Harden the week-isolation test**~~ ✅ exact per-week counts plus
   per-week-distinct ingredients, verified to fail when the `weekPlanId`
   filter is removed (the old assertions did not).

6. ~~**"Pick manually" swap**~~ ✅ whole-library picker with name search,
   rendered once beneath the week grid off `?pick=<day>`; already-planned
   recipes are marked but stay pickable; empty days gained a control they
   never had. Spec `2026-08-01-manual-pick-swap-design.md`, plan
   `2026-08-02-manual-pick-swap.md`.

7. ~~**PWA install**~~ ✅ manifest, drawn app mark, and icon set; installs to
   a home screen and opens standalone. Also deleted the scaffold favicon
   (there is now no `favicon.ico` — `src/app/icon.svg` covers it, since
   sharp cannot write `.ico`). The review caught that `/manifest.webmanifest`
   and `/icon.svg` fell through `src/proxy.ts`'s auth matcher, breaking
   installability before sign-in; fixed, and `src/proxy.test.ts` now locks
   the matcher down. Spec `2026-08-10-pwa-install-design.md`, plan
   `2026-08-11-pwa-install.md`.
   Still open as a later step: offline-cached shopping list (deliberately
   deferred — the list is auth-gated and `force-dynamic`, so caching it
   raises stale-data questions that deserve their own feature).

## Next (needs a design pass)
8. **Weeknight/weekend benefit split** (backlog #5) — `dayBenefit` in
   `src/lib/macro/equipment.ts` hardcodes speed Mon–Thu / quality Fri–Sun.
   Decision was to revisit after living with it; if the rhythm doesn't fit,
   promote to a household setting on the Family page.

## Later / opportunistic

9. **AI kcal variation** (backlog #4) — generated dinners echo the exact
   kcal target from the prompt, making the weekly ✓ self-fulfilling. Prompt
   for natural variation within the ±10% band, or accept as harmless.
10. **Login rate limiting** — the login action allows unlimited attempts;
    optional hardening for a household app.
11. **Monitoring** — no log drains / error tracking on the Vercel project;
    revisit if debugging prod gets annoying.
12. **Performance niceties** (from `deployment.md` deferred list) — index on
    `recipes.source`; batch the N+1 recipe fetches in `getWeek` with
    `inArray`. Neither is noticeable at household scale.

## Operational reminders

- If kitchen equipment is still unticked on the Family page, appliance-aware
  planning is dormant — tick the Miele gear on the live site.
- After any `src/lib/db/schema.ts` change: `db:generate` **and** `db:push`
  (tests stay green on PGlite even when Neon is unmigrated).
