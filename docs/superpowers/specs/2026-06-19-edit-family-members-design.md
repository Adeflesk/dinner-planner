# Edit Family Members — Design

**Date:** 2026-06-19
**Status:** Approved (design), pending spec review
**Area:** Family page (`src/app/(app)/family/`), family server actions

## Problem

On the Family page you can **add** a person and **delete** a person, but there is no way to **edit** one. Fixing a typo, updating a weight, or adjusting a goal currently requires deleting the person and re-creating them from scratch — losing nothing structurally (people aren't referenced by historical plans in a way that breaks), but tedious and error-prone.

## Goal

Let the user update any existing person's details in place on the Family page, within the project's no-client-JS convention (server components, plain HTML forms).

## What already works

The [`savePerson`](../../../src/app/actions/family.ts) server action is already update-capable:

```ts
const id = formData.get('id');
if (id) await db.update(people).set(values).where(eq(people.id, String(id)));
else await db.insert(people).values(values);
revalidatePath('/family');
```

When a hidden `id` field is present it issues an `UPDATE`; otherwise an `INSERT`. **No server-action or schema changes are required.** The work is purely surfacing an edit affordance in the UI that posts the person's `id` plus current values.

## Person fields (for pre-fill)

From the `people` table schema:

| Field | Input | Notes |
|---|---|---|
| `name` | text | |
| `age` | number | |
| `sex` | select | `male` \| `female` |
| `weightKg` | number (step 0.5) | |
| `heightCm` | number | |
| `activity` | select | `sedentary` \| `light` \| `moderate` \| `active` \| `very_active` |
| `goal` | select | `lose` \| `maintain` \| `gain` |
| `allergies` | text (comma-separated) | stored as `string[]` |
| `dislikes` | text (comma-separated) | stored as `string[]` |

## Design

### 1. Extract a shared `PersonForm` component

Today the "Add person" form is inline JSX in `family/page.tsx` with no pre-filled values. To support edit without duplicating nine fields (and the inevitable drift between two copies), extract a single component:

`src/app/(app)/family/PersonForm.tsx`

- Props: `{ person?: Person }` (the `person` type as selected from the `people` table).
- `action={savePerson}` in both modes.
- **Add mode** (`person` undefined): blank fields, no hidden `id` — identical behaviour to today's add form, submit label "Save person".
- **Edit mode** (`person` provided): every field pre-filled via `defaultValue`, **including the `sex`/`activity`/`goal` selects** (set `defaultValue` on the `<select>`); `allergies`/`dislikes` joined with `, `; a hidden `<input type="hidden" name="id" value={person.id} />`; submit label "Save changes".

`family/page.tsx`'s existing inline add-form section is replaced with `<PersonForm />`, keeping add and edit permanently in sync.

### 2. Per-card inline edit via `<details>`

Each person card in the list gains a native HTML disclosure — no client JS:

```
Alice  [remove]
42y · 70kg · maintain · daily 2100 kcal · dinner target 735 kcal / P55g
allergies: peanuts
▾ Edit
   └ <PersonForm person={p} />     ← collapsed by default
```

- `<details>` wraps a `<summary>Edit</summary>` and the edit-mode `<PersonForm person={p} />`.
- Collapsed by default (no `open` attribute).
- On submit, `savePerson` calls `revalidatePath('/family')` (already present); the page re-renders with updated values and the `<details>` returns to collapsed (fresh server render).
- The existing `remove` form and the read-only macro summary stay exactly as they are.

### Data flow

```
[Edit ▾]  →  expand <details>  →  pre-filled PersonForm (action=savePerson, hidden id)
   →  submit  →  savePerson(): UPDATE people SET ... WHERE id = ?  →  revalidatePath('/family')
   →  list re-renders with new values, card collapsed
```

### Error / edge handling

- Validation matches the existing add form: required attributes on `name`/`age`/`weightKg`/`heightCm`, numeric coercion in the action (`Number(...)`). No new validation surface is introduced.
- Empty `allergies`/`dislikes` → empty arrays (existing `list()` helper already handles this).
- Deleting a person is unchanged.

## Testing & verification

The new code is **presentational**: a shared form component and a `<details>` block. There is no new business logic — the insert-vs-update branch in `savePerson` already exists and is unchanged.

The repository currently has **no DB/action integration-test harness** (all existing tests are pure-logic unit tests: macro engine, ingredient parsing, dates, draft sequencing), and `savePerson` calls `getDb()` directly rather than taking an injectable `Db`. Standing up a PGlite harness and refactoring the action to be injectable purely to test a pre-existing one-line branch is out of scope for this UI change and is noted as separately trackable.

Best-practice verification for this change:

1. `npm test` — full suite stays green (no regressions).
2. `npm run build && npx tsc --noEmit` — clean, including the new `PersonForm` prop types.
3. Manual run (`npm run dev`): edit a person (e.g. change weight + goal), submit, confirm the card reflects new values and the macro line recalculates; confirm "Add person" still inserts a new person; confirm "remove" still works.

## Out of scope

- Refactoring `savePerson` into an injectable person service + introducing a PGlite action-test harness (worthwhile, but a separate concern from "let users edit").
- Any change to delete behaviour, settings, or pantry staples.
- Re-planning implications: editing a person changes future macro targets on the next plan/draft; no migration of existing plans is required.
