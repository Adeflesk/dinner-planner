# "Pick Manually" Swap — Design Spec

**Date:** 2026-08-01
**Status:** Approved by user (brainstorming session)
**Roadmap item:** 6 (`docs/roadmap.md`)

## Problem

A planned day can only be changed by rerolling: "Another favourite",
"New idea", or "More <cuisine>". Each picks *for* you. There is no way to
say "put the katsu curry on Wednesday" — you reroll and hope.

The service layer has supported this since the original build: `swapDay`
accepts `{ recipeId: string }` as a mode and resolves the recipe directly.
Nothing in the UI or the server action can reach that path, so the
capability is dormant. This spec adds the missing entry point.

## Decision

A "Pick manually" control on each day opens a picker, inline on the Plan
page, listing every recipe in the library with a name search. Choosing one
swaps that day via the `{ recipeId }` path that already exists.

## Scope of the list

**Every recipe in the library** — favourites (`source: 'family'`) and AI
dinners persisted from past plans (`source: 'ai'`). Nothing is unreachable.

The AI half grows roughly seven rows a week, bounded only by
`pruneOrphanAiRecipes`, which deletes AI recipes no longer referenced by
any `planned_dinners` row in any week. Past weeks keep their dinners, so
in practice the library grows without limit. That is why search is part of
this spec rather than a later addition.

## Placement

The picker renders **once, full-width, directly beneath the week grid**,
driven by a `?pick=<day>` search param. It is not rendered inside the day
card, for two reasons found while reading the page:

- The week grid is `lg:grid-cols-7` — seven narrow columns, each `p-3`
  with a 118px min-height, whose swap buttons already sit behind a
  `<details>` "more" disclosure. A search box plus a scrolling list inside
  one of those columns is unusable on a desktop.
- Today's dinner renders **twice**: once in the "tonight" hero and again in
  the week grid. A panel keyed on `?pick=2` and rendered per-card would
  open two identical pickers for today.

A single panel keyed off the search param avoids both. Each day's "Pick
manually" is a plain link to `/?pick=<day>&week=<raw>#pick` — navigation
only, no client JS, consistent with the existing `?planned=` / `?degraded=`
/ `?undo=` conventions.

## Service Layer

New function in `src/lib/services/planning.ts`:

```ts
export type PickerOption = {
  id: string;
  name: string;
  cuisine: string;
  kcal: number;              // recipe.perServing.kcal, rounded for display
  favourite: boolean;        // source === 'family'
  plannedDay: number | null; // day it already occupies THIS week, else null
};

export async function pickerOptions(
  db: Db,
  weekStart: string,
  query?: string,
): Promise<PickerOption[]>;
```

- **Filter:** when `query` is present and non-blank, case-insensitive
  substring match on name. A blank or whitespace-only query filters
  nothing.
- **Order:** favourites first, then AI dinners; each group newest-first by
  `createdAt`.
- **`plannedDay`:** resolved against this `weekStart` only — a recipe
  planned in a *different* week must come back `null`. This is the same
  cross-week isolation bug class hardened against in `planning.test.ts`,
  so it gets an explicit test.

The page stays thin and calls this service. (The Recipes page currently
queries the `recipes` table directly from the component; that is existing
drift, not a pattern to copy, and is out of scope to fix here.)

## Server Action

Extend `swapDayAction` in `src/app/actions/plan.ts` with a `pick` mode:

- On `mode === 'pick'`, read `recipeId`, apply the same malformed-id guard
  `updateRecipeAction` gained in 730e75b, and call
  `swapDay(getDb(), weekStart, day, { recipeId })`.
- The existing `SWAP_MODES` whitelist keeps guarding the other three
  buttons unchanged.
- `swapDay` returns `{ ok: false }` when the recipe cannot be resolved —
  it was deleted between render and submit. The action currently discards
  that return value; on the pick path it redirects with `?error=` instead
  of silently doing nothing.
- On success, `revalidatePath('/')` and redirect to `/?week=<raw>`,
  dropping `pick` and `q` so the panel closes.

## UI

`src/app/(app)/page.tsx`:

- `searchParams` type gains `pick?: string; q?: string`.
- `SwapButtons` gains a fourth control: a `Link` reading "Pick manually" →
  `/?pick=<day>&week=<raw>#pick`.
- **Empty days get the same link.** Today a day with no dinner renders only
  the text "Nothing planned" — the grid's swap buttons live inside the
  `dinner ?` branch, so there is no way to fill a gap by hand. `swapDay`
  handles an empty day fine (the delete is a no-op, then it persists), so
  the link is added to the empty branch too. This is the case where manual
  picking is most useful: AI failed to fill a slot and you want a specific
  dinner there.
- New `PickerPanel` server component, rendered below the week grid only
  when `pick` parses to an integer in 0–6:
  - Wrapper carries `id="pick"` so the `#pick` anchor lands on it.
  - Heading "Pick a dinner for <long day name>" and a close link back to
    `/?week=<raw>`.
  - A **GET** form for search: text input `q`, hidden `pick` and `week`,
    submit button. GET keeps the result shareable and the back button
    honest, and needs no JS.
  - A fixed-max-height scrolling list. Each row is a small **POST** form
    with hidden `day`, `week`, `recipeId`, `mode=pick`, showing name,
    cuisine, kcal, a `veg` marker where tagged, and — when
    `plannedDay !== null` — an "already on <Day>" note.
  - A result count ("3 of 214") and an empty state when nothing matches.

### Duplicates

A recipe already planned elsewhere this week **is listed, is marked, and
remains pickable**. The three existing swap modes skip used recipes via
`usedNames`; the `{ recipeId }` path does not, and deliberately so — a
manual pick is an explicit instruction. The marker prevents accidental
duplication without overriding intent.

## Testing

Integration tests (PGlite) for `pickerOptions`:

- ordering: favourites before AI, newest-first within each group
- search: matches case-insensitively; blank and whitespace-only queries
  filter nothing
- `plannedDay`: set for a recipe planned this week, `null` for one planned
  only in a *different* week, and set for a recipe on the target day itself

Action-level test: a malformed `recipeId` leaves the day unchanged; a valid
one replaces it.

No macro-engine changes, so no new unit tests there.

## Non-Goals

- No new route, no client JS, no schema change.
- No pagination beyond the scrolling box.
- No change to pinning. `swapDay` does not check the `pinned` flag today,
  so all three existing swap buttons already replace a pinned dinner;
  manual pick behaves identically rather than inventing a new rule.
- No fix for the Recipes page querying the database directly.
- No "save this AI dinner as a favourite" work — `promoteToFavourite`
  already exists on the Recipes page.
