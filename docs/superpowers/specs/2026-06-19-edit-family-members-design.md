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

When a hidden `id` field is present it issues an `UPDATE`; otherwise an `INSERT`. The insert/update **behaviour** is correct; no schema change is required. However, this logic lives directly in the action (`getDb()` called inline), which both diverges from the project's documented architecture (*"Services take a `Db` parameter… so the same code runs against Neon in prod and PGlite in tests"*) and leaves the update path untested. Best practices for this change therefore include extracting that logic into a testable service (see §3) so the edit path is covered by a real integration test.

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

### 3. Extract a testable person service

To align with the project's layering (*services take a `Db`; actions are thin wrappers*) and to make the edit path verifiable, move the upsert logic out of the action into a service:

`src/lib/services/people.ts`

```ts
export type PersonInput = {
  name: string; age: number; sex: 'male' | 'female';
  weightKg: number; heightCm: number;
  activity: 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
  goal: 'lose' | 'maintain' | 'gain';
  allergies: string[]; dislikes: string[];
};

// id present → UPDATE that row; id absent → INSERT.
export async function upsertPerson(db: Db, input: PersonInput, id?: string): Promise<void> { … }
export async function deletePersonById(db: Db, id: string): Promise<void> { … }
```

`savePerson`/`deletePerson` in `actions/family.ts` become thin: parse `FormData` (keeping the existing `list()` helper and numeric coercion), call the service with `getDb()`, then `revalidatePath('/family')`. Behaviour is identical to today; the logic is now injectable and unit-testable against PGlite.

### Data flow

```
[Edit ▾]  →  expand <details>  →  pre-filled PersonForm (action=savePerson, hidden id)
   →  submit  →  savePerson() parses FormData
   →  upsertPerson(db, input, id): UPDATE people SET ... WHERE id = ?  →  revalidatePath('/family')
   →  list re-renders with new values, card collapsed
```

### Error / edge handling

- Validation matches the existing add form: required attributes on `name`/`age`/`weightKg`/`heightCm`, numeric coercion in the action (`Number(...)`). No new validation surface is introduced.
- Empty `allergies`/`dislikes` → empty arrays (existing `list()` helper already handles this).
- Deleting a person is unchanged.

## Testing & verification

The repository currently has **no DB integration-test harness** — all existing tests are pure-logic unit tests (macro engine, ingredient parsing, dates, draft sequencing). This change introduces the first one, since CLAUDE.md already mandates the pattern (*services run against PGlite in tests*) and the `Db` type was built for exactly this.

**Test harness** (`src/lib/test/db.ts` or similar): a small helper that spins up an in-memory PGlite instance, applies the Drizzle schema/migrations, and returns a `Db`. This is reusable by future service tests, not just this one.

**`people.test.ts`** (integration, PGlite) covering the service:

1. `upsertPerson(db, input)` with no `id` → inserts a new row with the given values.
2. `upsertPerson(db, input, existingId)` → updates that row in place (changed fields persist, `id` unchanged, no extra row created) — the edit path this feature adds.
3. `deletePersonById(db, id)` → removes the row.
4. Array fields (`allergies`/`dislikes`) round-trip correctly through `jsonb`.

The `PersonForm` component and `<details>` block remain presentational (no unit test); they are covered by manual verification.

**Full verification:**

1. `npm run db:generate` (if migrations are needed for the harness) then `npm test` — full suite green, including the new `people.test.ts`.
2. `npm run build && npx tsc --noEmit` — clean, including the new `PersonForm` prop types and service signatures.
3. Manual run (`npm run dev`): edit a person (e.g. change weight + goal), submit, confirm the card reflects new values and the macro line recalculates; confirm "Add person" still inserts; confirm "remove" still works.

## Out of scope

- Any change to delete behaviour, settings, or pantry staples (beyond `deletePerson` moving to the new service unchanged).
- Re-planning implications: editing a person changes future macro targets on the next plan/draft; no migration of existing plans is required.
