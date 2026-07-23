# Recipe Detail Page — Design Spec

**Date:** 2026-07-19
**Status:** Approved by user (brainstorming session)
**Extends:** `2026-06-10-dinner-planner-design.md` (Recipes screen)

## Problem

The Recipes page lists every saved recipe, but AI-suggested ones show only
name and cuisine — there is no way to read their ingredients, method, or
macros without first promoting them to favourites. And no recipe of any
kind can be edited: a typo in an ingredient line or a tweaked method means
delete-and-retype.

## Decision

A per-recipe detail page at `/recipes/[id]`: full recipe details, cooking
history derived from past week plans, and an edit form mirroring the add
form with AI re-estimation ticked by default. Recipe names on the list
page become links to it.

## Non-Goals

- No schema change. History is derived from `planned_dinners` ×
  `week_plans`; edits update the existing `recipes` row.
- No client-side JS. Server components and plain forms, like every page.
- No search, filter, sort, or duplicate actions (considered, deferred).
- Delete stays on the list page; the detail page does not delete.
- Editing never rewrites history: past weeks' plans and lists are
  untouched, and portions already computed for planned dinners are not
  re-solved. Accepted: macros shown on a past plan reflect the recipe as
  it is now, not as it was cooked.

## List Page Changes

Every recipe name — favourites and AI-suggested — becomes a link to
`/recipes/[id]`. The inline `<details>` (ingredients & method) on
favourite cards is removed; cards keep the macro summary line, tags,
equipment chips, and the remove button. AI rows keep the
"Save as favourite" action. The add-recipe form is unchanged.

## Detail Page

Server component, `dynamic = 'force-dynamic'`, like its siblings. Unknown
id → `notFound()`.

**Details section:** name, source badge (family / AI-suggested), cuisine,
servings, per-serving macros (kcal, P/C/F), tags, equipment chips, full
ingredient list (quantity, unit, name), method. AI recipes also get the
existing "Save as favourite" button here, so one can be read in full
before deciding.

**Cooking history section:** all `planned_dinners` rows for this recipe
joined to `week_plans`, newest first. Headline: "Cooked {n} times · last
on {weekday} {date}" where the date is `weekStart` + `day` (0 = Monday …
6 = Sunday, per convention). Below, one line per occurrence. Never
planned → "Not cooked yet".

## Editing

The edit form sits on the detail page, prefilled, mirroring the add form
field-for-field: name, cuisine, servings, ingredients as one-per-line
text, method, tags (comma-joined), macro numbers, equipment checkboxes
(pre-checked from the recipe), and the "estimate macros & store sections
with AI" checkbox **ticked by default**.

Prefilling the ingredients textarea needs a formatter in
`src/lib/services/ingredients.ts` — `formatIngredientLines(ingredients)`,
the inverse of `parseIngredientLines`: one `"{quantity} {unit} {name}"`
line per ingredient. Round-trip through parse must preserve name,
quantity, and unit.

Saving posts to a new server action `updateRecipe` in
`src/app/actions/recipes.ts`, which parses the form and calls a new
service `updateRecipe(db, id, input)` in `src/lib/services/recipes.ts`
(takes `Db` like every service). Behaviour matches `saveRecipe`:

- With AI ticked, `estimateRecipe` (same injectable-generator pattern)
  supplies per-serving macros, parsed ingredients with store sections,
  and equipment; if AI is down or returns nothing, fall back to the
  typed values — an edit never fails to save.
- Without AI, ingredient lines are parsed with `parseIngredientLines`.
  Because the parser assigns every line `section: 'other'`, the service
  carries over each stored ingredient's `section` onto the new ingredient
  with the same canonical name; only genuinely new lines get `'other'`.
- `source` is never changed by an edit — editing an AI recipe does not
  promote it.

After saving, redirect back to `/recipes/[id]` and revalidate `/recipes`,
the detail page, `/shopping`, and `/` (recipe names appear on the plan).

## Shopping-List Knock-On

If the edit changed ingredients or servings (compared against the stored
row before update), and the recipe appears in any `planned_dinners` row
whose week's `weekStart` is the current week's Monday (via the existing
dates service) or later, delete those weeks' `shopping_lists` rows —
exactly the invalidation a re-plan performs. Cosmetic edits (name,
cuisine, method, tags, equipment, macros only) invalidate nothing. Past
weeks are never touched.

## Error Handling

- Unknown recipe id on the detail page → `notFound()`; in the update
  action → return without changes.
- Blank required fields are prevented by the same `required` attributes
  the add form uses; a hand-crafted empty POST falls back to the
  `saveRecipe` defaults (servings 4, cuisine 'any').
- AI estimation failure during edit: silent fallback to typed values,
  identical to the add flow.

## Testing

Unit tests (`src/lib/services/ingredients.test.ts`):

- `formatIngredientLines` renders `"{quantity} {unit} {name}"` lines and
  round-trips through `parseIngredientLines`.

PGlite service tests (`src/lib/services/recipes.test.ts`):

- `updateRecipe` patches all fields; `source` and `createdAt` unchanged.
- Section carry-over: editing without AI keeps stored sections for
  matching canonical names; new lines get `'other'`.
- With a faked generator, AI estimate overrides typed macros/ingredients;
  a failing generator falls back to typed values.
- Invalidation: ingredient change deletes shopping lists only for
  current/future weeks containing the recipe; past-week lists and
  unrelated weeks survive; cosmetic edits delete nothing.
- History query returns occurrences newest-first and computes the cooked
  date from `weekStart` + `day`.

UI layer verified by typecheck + build per repo convention.
