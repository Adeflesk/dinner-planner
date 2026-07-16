# Backlog — improvements parked, not forgotten

From the app review of 2026-07-08. Ordered by rough value. Each larger item
should go through the normal brainstorm → spec → plan cycle before code.

## 1. Plan next week (biggest functional gap)

The app is hard-locked to the current week — `currentWeekStart()` is baked into
the Plan page, Shopping page, and their server actions. On a weekend you cannot
plan Monday onward. Needs week navigation (at minimum "this week / next week")
threaded through plan + shopping pages and the week-keyed services. Proper
feature: brainstorm first.

## 2. Mark-as-staple from the shopping list

One tap on a list item teaches the app it's a pantry staple, so it stops
appearing on future lists (salt, pepper, soy sauce…). The staples table is
nearly empty because maintaining it on the Family page is friction. Was
deliberately deferred from the shopping-hardening round; small feature but
worth a quick design pass (where does the tap live, undo, does it remove the
item from the current list too?).

## 3. Spread vegetarian nights across the week

The planner assigns vegetarian nights from day 0 until the quota is spent, so
"3 veg nights" always lands Mon–Tue–Wed. Spread them (e.g. every other slot,
or random-with-spacing like the cuisine sequence). Pure change in
`src/lib/planner/draft.ts` — small, unit-testable.

## 4. AI dinners all land exactly on the kcal target

Every generated dinner comes back at precisely the per-serving target (e.g.
784 kcal across the whole week), because the model echoes the number in the
prompt. Makes the weekly macro ✓ somewhat self-fulfilling. Options: prompt for
natural variation within the ±10% band, or accept as harmless. Low priority.

## 5. Weeknight/weekend benefit split is hardcoded

Appliance-aware planning leans "speed" Mon–Thu and "quality" Fri–Sun
(`dayBenefit` in `src/lib/macro/equipment.ts`). Decision from the design
session was to revisit after living with it — could become a household
setting if the rhythm doesn't fit.

## 6. Phone polish: PWA install

Home-screen icon + standalone window for the in-store shopping flow
(manifest + icons; optionally offline-cached shopping list later).
Also: if kitchen equipment is still unticked on the Family page, the whole
appliance-aware feature is dormant — tick the Miele gear.

## Small warts (fix opportunistically)

- **`deleteRecipe` silently no-ops** when the recipe is planned this week (FK
  guard in `src/app/actions/recipes.ts`) — the "remove" button just looks
  broken. Surface a "can't remove while planned" notice.
- **Login rate limiting** — optional hardening once the household password is
  strong; the login action currently allows unlimited attempts.
- **Monitoring** — no log drains / error tracking on the Vercel project.
  Fine for a family app; revisit if debugging prod ever gets annoying.
- **`cup` units aren't in the canon** — spotted on the live week-of-Jul-6 list:
  two `basmati rice` lines because one recipe measured in gram and another in
  a unit the canon can't convert (e.g. cup). Adding per-ingredient cup→g
  factors for rice/flour-like staples would merge these.
- **Harden the week-isolation test** (from the two-week-window final review):
  in `planning.test.ts`'s "two-week window" test, tighten `dinners.length > 7`
  to exact per-week counts, and give the fake generator per-week-distinct
  ingredients so a lost `weekPlanId` filter in `weekScaledRecipes` would be
  caught by list-content assertions (today only row-ids are compared).
