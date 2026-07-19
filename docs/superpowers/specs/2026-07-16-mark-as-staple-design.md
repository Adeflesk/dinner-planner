# Mark-as-Staple from the Shopping List — Design Spec

**Date:** 2026-07-16
**Status:** Approved by user (brainstorming session)
**Extends:** `2026-06-10-dinner-planner-design.md` (Shopping screen, pantry staples)

## Problem

The `pantry_staples` table is nearly empty because the only way to add a
staple is the Family page, which nobody visits mid-shop. The friction shows
up in the store: salt, soy sauce, and olive oil keep appearing on the list
even though they are always at home. Backlog item 2.

## Decision

One tap on a shopping-list row marks that item as a pantry staple: the name
is added to `pantry_staples`, the row is removed from the current list, and
an inline notice with **Undo** appears. Undo deletes the staple and restores
the item exactly as it was.

## Non-Goals

- No schema change. `pantry_staples` (id + unique name) is enough.
- No client-side JS. Plain forms + redirect, like every other list action.
- No retroactive cleanup of other weeks: marking is global, but an
  already-built list for the other week keeps the item until that list is
  next rebuilt. Accepted.
- No change to the Family page staples editor or the pre-build
  "running low" staples check — both keep working as-is, and a newly
  marked staple naturally joins them.

## Behavior

On the built-list view the page additionally fetches `pantry_staples` (it
currently does so only in the pre-build state) and compares canonical
names. Every row whose canonical name is **not** already in
`pantry_staples` gets a third compact icon button, placed between the item
text and the remove ×, with an accessible label
"Mark {name} as a pantry staple". It appears on checked and manual items
alike. Rows that already are staples (the "running low" lines ticked at
build time) show no button — they are staples already, and hiding it
removes the ambiguous undo case (undo can always delete the staple it
created).

Tapping the button:

1. inserts the item's name into `pantry_staples`
   (`onConflictDoNothing` — a concurrent duplicate no-ops),
2. removes the item from the list's `items` JSON,
3. redirects back to the shopping page with an undo payload in the URL.

The page then shows a notice above the list:
*"Marked {name} as a pantry staple — it won't appear on future lists.
Undo."* The Undo button posts the payload back; undo deletes the staple row
by name and appends the item to the list with its original quantity, unit,
section, `checked`, and `manual` fields. Any other navigation or action
redirects to a clean URL, dismissing the notice — undo is a same-visit
affordance, not durable state.

## Service Layer

Two functions in `src/lib/services/shopping.ts`, following the existing
`removeItem` pattern (load list → transform `items` → update):

- `markItemStaple(db, listId, index)` — validates the index, inserts the
  item name into `pantryStaples` with `onConflictDoNothing`, splices the
  item out of `items`, returns the removed `StoredShoppingItem` (or `null`
  when the list/index is missing).
- `undoMarkStaple(db, listId, name, item)` — deletes the staple row whose
  name matches, appends `item` to the list's `items`.

The staple stores the item's display name as-is; all existing staple
matching (`buildList`, `staplesCheck`, `aggregateIngredients`) already
compares via `canonicalName()` on both sides, so synonyms keep working.

## Server Actions & URL Contract

Two thin actions in `src/app/actions/shopping.ts`, mirroring the existing
ones (parse `FormData`, call service with `getDb()`, `revalidatePath`,
redirect):

- `markStapleAction` — fields `listId`, `index`, `week`. Calls
  `markItemStaple`; redirects to
  `/shopping?week={raw}&undo={base64url(JSON of {name, item})}`.
- `undoStapleAction` — fields `listId`, `week`, `undo` (the same payload).
  Calls `undoMarkStaple`; redirects to `/shopping?week={raw}` (clean URL).

The page decodes the `undo` search param inside a try/catch and ignores
anything that fails to parse or lacks the expected shape — a garbled or
hand-edited payload renders no notice and never throws. The week param
follows the existing two-week-window contract (`resolveWeekStart` on the
raw value).

## Error Handling

- Missing list or out-of-range index (stale tab, concurrent edit): service
  returns without changes, action redirects normally — same accepted
  exposure as the existing remove button.
- Undo with a valid payload but an already-deleted staple or list: the
  delete/append parts each no-op independently; no error surfaces.

## Testing

PGlite service tests in `src/lib/services/shopping.test.ts`:

- Marking inserts the staple and removes exactly that item from the list.
- A subsequent `buildList` excludes the marked ingredient from the derived
  items (it may reappear only via the "running low" flow).
- Marking an item whose name is already a staple still removes the item and
  does not error (conflict no-op).
- Undo restores the item with `manual` and `checked` preserved and deletes
  the staple; a following `buildList` derives the ingredient again.
- Out-of-range index and unknown list id leave everything unchanged.

UI layer verified by typecheck + build per repo convention.
