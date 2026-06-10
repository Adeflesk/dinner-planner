# Family Dinner Planner — Design Spec

**Date:** 2026-06-10
**Status:** Approved by user (brainstorming session)

## Problem

Planning a week of dinners for a family of four is a chore: deciding seven meals, making sure they hit nutritional targets (macros), and turning them into a usable shopping list. The user wants dietary guidance built in — the app should *tell them* what their macro targets are, not assume they already know.

## Goals

- Draft a week of 7 dinners in one click, mixing household favourites with AI-suggested new ideas.
- Calculate per-person daily macro targets from basic profile info, and allocate a dinner share.
- One shared meal per night, with per-person portion guidance so each person lands near their own targets.
- Generate a consolidated shopping list from the week: aggregated ingredients, pantry staples removed, grouped by store section.
- Respect allergies (hard exclusions), per-person dislikes, and diet-style rules (e.g. "2 vegetarian dinners a week").

## Non-Goals

- Breakfast/lunch planning, snacks, or full-day calorie tracking.
- Per-user accounts, multi-household support, or social features.
- Native mobile apps (the web app must be mobile-friendly, especially the shopping list).
- Per-person meal variations (one pot, different portion sizes only).
- Grocery delivery / store API integration.

## Architecture

Single **Next.js (App Router)** app deployed on **Vercel**.

- **UI + API:** Server Components and Server Actions; no separate backend.
- **Database:** **Neon Postgres** via Vercel Marketplace.
- **AI:** **Vercel AI Gateway** through the AI SDK. All recipe generation uses `generateObject` with a Zod schema — structured JSON out, no free-text parsing. AI is used **only** to generate/estimate recipe content; all arithmetic (targets, portions, tallies, aggregation) is deterministic TypeScript.
- **Auth:** single shared household password → cookie session. Everyone with the password sees the same household data.

### Macro engine (pure TypeScript module)

Deterministic, dependency-free functions, unit-tested:

- **Daily targets per person:** Mifflin-St Jeor BMR × activity multiplier, adjusted for goal (lose −15% / maintain / gain +10% calories). Macro split: protein 1.8 g per kg bodyweight, fat 25% of calories, remaining calories as carbs.
- **Dinner share:** default **35%** of daily calories (household-adjustable) → per-person dinner macro targets.
- **Portion solver:** given a recipe's per-serving macros and each person's dinner targets, compute per-person serving multipliers (e.g. 1.5 / 1.25 / 0.75 / 0.75) and the total household scale factor.
- **Weekly tally:** sum planned dinners vs. combined household dinner targets; per-macro ✅/⚠️ status.
- **List aggregation:** merge ingredients across 7 scaled dinners (combining duplicates and compatible units), filter pantry staples, group by store section.

## Data Model

| Table | Fields (essence) |
| --- | --- |
| **Person** | name, age, sex, weight, height, activity level, goal, allergies[], dislikes[] |
| **Recipe** | name, method, servings, per-serving macros (kcal/P/C/F), tags[] (diet style, cuisine), source (`family` \| `ai`), ingredients[] (name, qty, unit, store section) |
| **WeekPlan** | week start date; 7 × **PlannedDinner** (day, recipeId, household scale, per-person portion multipliers, pinned flag) |
| **PantryStaple** | ingredient name (always-stocked; excluded from lists) |
| **ShoppingList** | weekPlanId, items[] (name, qty, unit, section, checked, manual flag) — persisted so manual edits survive regeneration |

Household settings: dinner share %, diet-style rules (e.g. vegetarian-nights-per-week), preferred cuisines list.

## Screens

### 1. Plan (home) — week-at-a-glance grid

Seven day cards (dinner name, per-serving macros, tags, swap button) plus a weekly macro summary bar (per-macro ✅/⚠️ vs. household dinner targets). Actions:

- **Plan my week:** drafts 7 dinners — roughly half from saved favourites (rotated to avoid last week's repeats), half AI-suggested — all filtered by allergies/dislikes and satisfying diet-style rules, steered toward macro targets. The draft spreads dinners across the household's preferred cuisines (no two same-cuisine nights in a row). Pinned days survive re-drafts.
- **Swap (per day):** another favourite / new AI idea / another idea in this cuisine / pick manually.
- **Dinner detail:** ingredients, method, and the portion table ("Adam ×1.5, Beth ×1.25, kids ×0.75").
- **Build shopping list** button.

### 2. Shopping list

Generated from the current week. Aggregated + scaled ingredients, pantry staples removed, grouped by store section (produce, meat & fish, dairy, pantry, frozen, other). Items can be ticked off, added, or removed; mobile-friendly layout.

### 3. Recipes

Favourites library: add/edit recipes. An **"estimate macros with AI"** helper fills per-serving macros and store sections from the typed ingredient list; user can correct values before saving. Liked AI-generated dinners can be saved as favourites.

### 4. Family

The four person profiles (stats, goal, allergies, dislikes), diet-style rules, **preferred cuisines** (e.g. Indian, Mexican, Italian — drives the weekly variety mix), dinner-share %, and the pantry staples list.

## AI Integration Details

- Model access via AI Gateway `"provider/model"` string; no provider SDK lock-in.
- `generateObject` with a Recipe Zod schema for: weekly draft suggestions, single-day swap suggestions, and macro estimation for user-entered recipes.
- Prompt inputs: macro targets, allergies (hard), dislikes (hard), diet-style rules, the household's preferred cuisine list (with the cuisine requested per slot for variety), recent recipe names (to avoid repeats), cuisine tags of favourites (for taste fit).

### Validation of AI output (in code, after schema validation)

1. **Energy consistency:** kcal ≈ 4·protein + 4·carbs + 9·fat within ±15%, else reject.
2. **Allergy re-screen:** ingredient names checked against allergy list, else reject.
3. Rejected recipes are silently regenerated (1 retry per slot); never shown to the user.

## Error Handling

- **AI unavailable/slow:** weekly draft falls back to favourites-only with a visible notice. Timeout + one retry per call. AI failure never blocks planning or shopping-list generation.
- **Sparse favourites (fresh install):** draft becomes more AI-heavy; the half-and-half mix is a preference, not a constraint.
- **Unreachable targets:** if no portion split gets everyone within ~10% of their dinner targets, the day card shows ⚠️ with actual numbers — honest, not blocking.
- **Unit conflicts in aggregation:** incompatible units (e.g. "1 bunch" + "200 g") are listed as separate line items rather than guessed.

## Testing Strategy

- **Unit tests (bulk of coverage):** the macro engine — target calculation, portion solver, weekly tallies, ingredient aggregation/unit merging, pantry filtering, AI sanity checks. Deterministic, no mocks needed.
- **Integration tests:** Server Actions against a test database — plan a week, pin + re-draft, swap a day, generate and edit a shopping list.
- **AI mocked everywhere in tests:** fixture recipes; no live model calls in CI.

## Decisions Log

| Decision | Choice |
| --- | --- |
| Recipe source | Mix: household favourites + AI suggestions |
| Macro targets | App-calculated from per-person profiles |
| Portions | Same meal, per-person portion guidance |
| Shopping list | Grouped by store section, pantry-aware, ingredients aggregated |
| Platform | Web app (Next.js on Vercel) |
| Planning flow | App drafts the week, user adjusts/swaps |
| Diet rules | Allergies, diet styles, per-person dislikes |
| Cuisines | Variety mix: household picks preferred cuisines; draft spreads across them, no same-cuisine nights back-to-back |
| Stack | Next.js + Neon Postgres + AI Gateway (Approach A) |
| Main layout | Week-at-a-glance grid (Option A, chosen via visual mockups) |
| Auth | Single shared household password |
