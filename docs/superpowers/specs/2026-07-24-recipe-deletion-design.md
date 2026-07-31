# Recipe Deletion from the Detail Page — Design Spec

**Date:** 2026-07-24
**Status:** Approved by user (brainstorming session)
**Extends:** `2026-07-19-recipe-detail-page-design.md` (Recipe detail page)

## Problem

The detail page has no way to delete a recipe — by original design, delete
stayed on the list page. Worse, the list page's delete guard blocks
removing a recipe that is referenced by **any** `planned_dinners` row,
past or future (`recipes.id` has no `onDelete` cascade, so the FK would
reject it anyway). In practice this means a recipe cooked even once can
never be deleted, forever — the actual blocker behind "there's no way to
clear up the page."

## Decision

Loosen the guard to only block deletion when the recipe is planned in the
**current or a future week** (the same current/future rule already used
for shopping-list invalidation). A recipe whose only history is past weeks
becomes deletable; deleting it also deletes its own past `planned_dinners`
rows. Add a delete action to the detail page, with a no-JS two-step confirm
and a message when blocked.

## Non-Goals

- No delete button added to AI-suggested rows on the list page — this spec
  only adds delete to the detail page. The list page's existing favourites
  "remove" button keeps its current silent-on-blocked UX; only its
  underlying rule loosens (see below).
- No schema change. No `onDelete` cascade added to the `planned_dinners →
  recipes` FK — cascading is done at the application layer instead.
- No database transaction. The two deletes (past `planned_dinners` rows,
  then the recipe) run as sequential awaited statements, not wrapped in a
  `db.transaction()`. This codebase has no transaction precedent anywhere
  and the Neon HTTP driver's transaction semantics are unexercised by any
  existing code; this is a single-household app with no realistic
  concurrent writers, so the small race window (a dinner gets planned
  between the guard check and the delete) is an accepted, deliberate
  simplification rather than a reason to introduce a new pattern.
- Deleting a recipe never touches other recipes' rows, other days in the
  same past week, or that week's shopping list (a static JSON snapshot,
  unaffected either way).

## Service Layer

New function in `src/lib/services/recipes.ts`:

```ts
export async function deleteRecipe(db: Db, id: string, now: Date = new Date()): Promise<'deleted' | 'blocked'>
```

- Blocked check: same join used by `updateRecipe`'s shopping-list
  invalidation — any `planned_dinners` row for this recipe whose week's
  `weekStart >= currentWeekStart(now)`. If found, return `'blocked'`
  without changing anything.
- Otherwise: delete the recipe's `planned_dinners` rows (all of them are
  necessarily past-only, having passed the check above), then delete the
  recipe row. Return `'deleted'`.
- An unknown recipe id behaves like an already-deleted recipe: the
  `planned_dinners` delete matches nothing, the `recipes` delete matches
  nothing, and the function returns `'deleted'` — a harmless no-op, not an
  error.

## Actions (`src/app/actions/recipes.ts`)

- The existing list-page action `deleteRecipe` is renamed to
  `deleteRecipeAction` (frees the `deleteRecipe` name for the service,
  matching this file's own `updateRecipeAction` precedent). Its single
  call site (`src/app/(app)/recipes/page.tsx`) is updated to match. Its
  behavior is otherwise unchanged from the caller's point of view: it
  calls the service, ignores the return value, and always
  `revalidatePath('/recipes')` — silent no-op on `'blocked'`, exactly as
  today. Only the underlying rule loosens (past-only history no longer
  blocks it).
- New action `deleteRecipeFromDetailAction(formData)`, same file: reads
  `id`, rejects a malformed (non-UUID) id the same way
  `updateRecipeAction` does (return without changes), otherwise calls
  `deleteRecipe(getDb(), id)`. On `'blocked'`, `redirect` to
  `/recipes/${id}?blocked=planned`. On `'deleted'`,
  `revalidatePath('/recipes')` then `redirect('/recipes')`.

## Detail Page UI

Header section gains a small delete control, styled like the list page's
existing "remove" button (`text-xs text-soft hover:text-tomato`):

- Default state: a plain `<Link href={`/recipes/${id}?confirmDelete=1`}>`
  reading "Delete recipe" — a GET navigation, no client JS.
- Confirm state (`confirmDelete` search param present): replaces that
  link with "Delete this recipe? This can't be undone." plus a real POST
  form button "Yes, delete" (`action={deleteRecipeFromDetailAction}`) and
  a "Cancel" `<Link>` back to the plain `/recipes/${id}`.
- Blocked state (`blocked=planned` search param present, i.e. redirected
  back after a blocked delete attempt): shows "Can't delete — this recipe
  is planned this week or later," styled `text-tomato` like the login
  page's error message (`src/app/login/page.tsx`).

These three states are driven entirely by which search params are
present — no client state, matching the existing `?error=` (login) and
`?undo=` (shopping) conventions in this codebase. `blocked` takes
precedence over `confirmDelete` if both are somehow present (e.g. a stale
back-navigation): the blocked message reflects a real server response and
wins over a stale confirm prompt.

## Error Handling

- Malformed id on `deleteRecipeFromDetailAction`: return without changes
  (same convention as `updateRecipeAction`).
- Already-deleted / unknown id: service returns `'deleted'` (no-op),
  action redirects to `/recipes` as if it succeeded — same accepted
  exposure as other actions in this file for a stale tab or double-submit.
- Blocked delete: surfaced via the `?blocked=planned` message described
  above, not a thrown error.

## Testing

PGlite service tests appended to `src/lib/services/recipes.test.ts`:

- Deleting a recipe with only past `planned_dinners` history succeeds:
  the recipe row and its past `planned_dinners` rows are gone; returns
  `'deleted'`.
- Deleting a recipe planned in the current week returns `'blocked'` and
  changes nothing (recipe row and its `planned_dinners` row both
  survive).
- Deleting a recipe planned in a future week returns `'blocked'`,
  same as above.
- Deleting a recipe with both a past occurrence and a current/future one
  is blocked; nothing is deleted (not even the past row).
- Deleting a recipe with no `planned_dinners` history at all succeeds.
- Deleting an unknown id returns `'deleted'` and changes nothing (no-op,
  not an error).
- Deleting a recipe does not affect a different recipe's `planned_dinners`
  rows or any week's `shopping_lists` row.

UI layer (both renamed/new actions, the detail page's three search-param
states) verified by typecheck + build per repo convention.
