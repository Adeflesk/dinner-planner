# Edit Family Members Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user edit an existing family member in place on the Family page (not just add/delete), and make the person upsert logic properly testable.

**Architecture:** Extract the people insert/update logic out of the server action into an injectable `people` service that takes a `Db` (matching the project's documented layering), cover it with the repo's first PGlite integration test via a reusable test-db harness, then surface editing in the UI through a shared `PersonForm` server component rendered inside a native HTML `<details>` disclosure per person card. No client JS.

**Tech Stack:** Next.js App Router (server components + server actions), Drizzle ORM, Neon (prod) / PGlite (tests), Vitest, Tailwind.

## Global Constraints

- **Day indexing:** 0 = Monday … 6 = Sunday (not touched here, but the project rule).
- **No per-user accounts:** single shared household password; people are household members, not auth users.
- **Layering:** services take a `Db` parameter; server actions are thin wrappers (parse `FormData`, call a service with `getDb()`, `revalidatePath`). No business logic in actions or pages.
- **No client JS:** UI is server components with plain HTML forms. Use native `<details>` for disclosure, never JS toggles.
- **Tests never hit Neon or live AI:** integration tests run on in-memory PGlite.
- **Path alias:** `@/` → `./src` (configured in both `tsconfig.json` and `vitest.config.ts`).
- **Person fields & enums (verbatim from schema):** `name: text`, `age: integer`, `sex: 'male' | 'female'`, `weightKg: real`, `heightCm: real`, `activity: 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active'`, `goal: 'lose' | 'maintain' | 'gain'`, `allergies: string[] (jsonb)`, `dislikes: string[] (jsonb)`, `id: uuid` (db-generated).

---

## File Structure

- **Create** `src/lib/test/db.ts` — reusable PGlite test-db factory (`createTestDb`). Applies Drizzle migrations from `./drizzle`.
- **Create** `src/lib/test/db.test.ts` — smoke test proving migrations apply and tables are queryable.
- **Create** `src/lib/services/people.ts` — `upsertPerson`, `deletePersonById`, `PersonInput` type. The only place people rows are written.
- **Create** `src/lib/services/people.test.ts` — PGlite integration tests for the service (insert, update-in-place, jsonb round-trip, delete).
- **Modify** `src/app/actions/family.ts` — `savePerson` / `deletePerson` become thin wrappers over the service.
- **Create** `src/app/(app)/family/PersonForm.tsx` — shared add/edit form server component.
- **Modify** `src/app/(app)/family/page.tsx` — use `<PersonForm />` for the add section; add a `<details>` edit disclosure with `<PersonForm person={p} />` to each card.

---

## Task 1: PGlite test-db harness

**Files:**
- Create: `src/lib/test/db.ts`
- Test: `src/lib/test/db.test.ts`

**Interfaces:**
- Consumes: existing `Db` type from `src/lib/db` (`PgDatabase<PgQueryResultHKT, typeof schema>`); Drizzle migration files in `./drizzle`.
- Produces: `createTestDb(): Promise<Db>` — a fresh in-memory Postgres with the full schema applied. Reused by every service test.

- [ ] **Step 1: Write the failing smoke test**

Create `src/lib/test/db.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { people } from '@/lib/db/schema';
import { createTestDb } from './db';

describe('createTestDb', () => {
  it('applies migrations so tables are queryable and empty', async () => {
    const db = await createTestDb();
    expect(await db.select().from(people)).toEqual([]);
  });

  it('returns an isolated database each call', async () => {
    const a = await createTestDb();
    const b = await createTestDb();
    await a.insert(people).values({
      name: 'Solo', age: 30, sex: 'male', weightKg: 80, heightCm: 180,
      activity: 'moderate', goal: 'maintain', allergies: [], dislikes: [],
    });
    expect(await a.select().from(people)).toHaveLength(1);
    expect(await b.select().from(people)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/test/db.test.ts`
Expected: FAIL — `Failed to resolve import "./db"` / `createTestDb is not a function`.

- [ ] **Step 3: Write the harness**

Create `src/lib/test/db.ts`:

```ts
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '@/lib/db/schema';
import type { Db } from '@/lib/db';

// In-memory Postgres for integration tests. Each call is a brand-new,
// isolated database with all Drizzle migrations applied.
export async function createTestDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: './drizzle' });
  return db as unknown as Db;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/test/db.test.ts`
Expected: PASS (2 tests). If migration fails on `gen_random_uuid()`, it indicates a PGlite/PG version issue — stop and report; do not work around by editing migrations.

- [ ] **Step 5: Commit**

```bash
git add src/lib/test/db.ts src/lib/test/db.test.ts
git commit -m "test: PGlite test-db harness with applied migrations"
```

---

## Task 2: people service

**Files:**
- Create: `src/lib/services/people.ts`
- Test: `src/lib/services/people.test.ts`

**Interfaces:**
- Consumes: `createTestDb` from `@/lib/test/db`; `people` table from `@/lib/db/schema`; `Db` from `@/lib/db`.
- Produces:
  - `type PersonInput = { name: string; age: number; sex: 'male' | 'female'; weightKg: number; heightCm: number; activity: 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active'; goal: 'lose' | 'maintain' | 'gain'; allergies: string[]; dislikes: string[] }`
  - `upsertPerson(db: Db, input: PersonInput, id?: string): Promise<void>` — `id` present → UPDATE that row; absent → INSERT.
  - `deletePersonById(db: Db, id: string): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/services/people.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createTestDb } from '@/lib/test/db';
import { people } from '@/lib/db/schema';
import { deletePersonById, upsertPerson, type PersonInput } from './people';

const sample: PersonInput = {
  name: 'Alice', age: 42, sex: 'female',
  weightKg: 70, heightCm: 168, activity: 'moderate', goal: 'maintain',
  allergies: ['peanuts'], dislikes: ['olives'],
};

describe('upsertPerson', () => {
  it('inserts a new person when no id is given', async () => {
    const db = await createTestDb();
    await upsertPerson(db, sample);
    const rows = await db.select().from(people);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'Alice', weightKg: 70, goal: 'maintain' });
    expect(rows[0].allergies).toEqual(['peanuts']);
  });

  it('updates the existing row in place when an id is given', async () => {
    const db = await createTestDb();
    await upsertPerson(db, sample);
    const [created] = await db.select().from(people);
    await upsertPerson(db, { ...sample, weightKg: 75, goal: 'lose' }, created.id);
    const rows = await db.select().from(people);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(created.id);
    expect(rows[0].weightKg).toBe(75);
    expect(rows[0].goal).toBe('lose');
  });

  it('round-trips array fields through jsonb', async () => {
    const db = await createTestDb();
    await upsertPerson(db, { ...sample, allergies: ['gluten', 'shellfish'], dislikes: [] });
    const [row] = await db.select().from(people);
    expect(row.allergies).toEqual(['gluten', 'shellfish']);
    expect(row.dislikes).toEqual([]);
  });
});

describe('deletePersonById', () => {
  it('removes the row', async () => {
    const db = await createTestDb();
    await upsertPerson(db, sample);
    const [row] = await db.select().from(people);
    await deletePersonById(db, row.id);
    expect(await db.select().from(people)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/services/people.test.ts`
Expected: FAIL — `Failed to resolve import "./people"`.

- [ ] **Step 3: Write the service**

Create `src/lib/services/people.ts`:

```ts
import { eq } from 'drizzle-orm';
import type { Db } from '@/lib/db';
import { people } from '@/lib/db/schema';

export type PersonInput = {
  name: string;
  age: number;
  sex: 'male' | 'female';
  weightKg: number;
  heightCm: number;
  activity: 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
  goal: 'lose' | 'maintain' | 'gain';
  allergies: string[];
  dislikes: string[];
};

// id present → update that person; id absent → insert a new one.
export async function upsertPerson(db: Db, input: PersonInput, id?: string): Promise<void> {
  if (id) await db.update(people).set(input).where(eq(people.id, id));
  else await db.insert(people).values(input);
}

export async function deletePersonById(db: Db, id: string): Promise<void> {
  await db.delete(people).where(eq(people.id, id));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/services/people.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/people.ts src/lib/services/people.test.ts
git commit -m "feat: people service with upsert/delete and PGlite tests"
```

---

## Task 3: thin family actions

**Files:**
- Modify: `src/app/actions/family.ts`

**Interfaces:**
- Consumes: `upsertPerson`, `deletePersonById`, `PersonInput` from `@/lib/services/people`; existing `getDb`, `revalidatePath`, and `list()` helper.
- Produces: unchanged action signatures `savePerson(formData: FormData)` and `deletePerson(formData: FormData)` (other consumers — `PersonForm`, the page — keep importing them by the same names).

- [ ] **Step 1: Replace the people logic in the action**

In `src/app/actions/family.ts`, update the imports at the top. Replace:

```ts
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { pantryStaples, people, settings } from '@/lib/db/schema';
```

with:

```ts
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { pantryStaples, settings } from '@/lib/db/schema';
import { deletePersonById, upsertPerson, type PersonInput } from '@/lib/services/people';
```

Then replace the existing `savePerson` and `deletePerson` functions:

```ts
export async function savePerson(formData: FormData) {
  const input: PersonInput = {
    name: String(formData.get('name')),
    age: Number(formData.get('age')),
    sex: String(formData.get('sex')) as PersonInput['sex'],
    weightKg: Number(formData.get('weightKg')),
    heightCm: Number(formData.get('heightCm')),
    activity: String(formData.get('activity')) as PersonInput['activity'],
    goal: String(formData.get('goal')) as PersonInput['goal'],
    allergies: list(formData.get('allergies')),
    dislikes: list(formData.get('dislikes')),
  };
  const id = formData.get('id');
  await upsertPerson(getDb(), input, id ? String(id) : undefined);
  revalidatePath('/family');
}

export async function deletePerson(formData: FormData) {
  await deletePersonById(getDb(), String(formData.get('id')));
  revalidatePath('/family');
}
```

Leave `saveSettings`, `addStaple`, `removeStaple`, and the `list()` helper exactly as they are. `eq` is still used by `removeStaple`, so keep its import.

- [ ] **Step 2: Verify the type-check passes**

Run: `npx tsc --noEmit`
Expected: clean (no errors). In particular, no "people is declared but never used" — the `people` import was removed.

- [ ] **Step 3: Verify the full suite still passes**

Run: `npm test`
Expected: all tests pass (including the new `db.test.ts` and `people.test.ts`).

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/family.ts
git commit -m "refactor: family actions delegate to people service"
```

---

## Task 4: shared PersonForm component (add mode)

**Files:**
- Create: `src/app/(app)/family/PersonForm.tsx`
- Modify: `src/app/(app)/family/page.tsx`

**Interfaces:**
- Consumes: `savePerson` from `@/app/actions/family`; `people` table type from `@/lib/db/schema`.
- Produces: `PersonForm({ person }: { person?: Person })` where `type Person = typeof people.$inferSelect`. Add mode when `person` is undefined; edit mode (pre-filled + hidden `id`) when provided.

- [ ] **Step 1: Create the component**

Create `src/app/(app)/family/PersonForm.tsx`:

```tsx
import { people } from '@/lib/db/schema';
import { savePerson } from '@/app/actions/family';

type Person = typeof people.$inferSelect;

export function PersonForm({ person }: { person?: Person }) {
  return (
    <form action={savePerson} className="grid grid-cols-2 gap-2 text-sm">
      {person && <input type="hidden" name="id" value={person.id} />}
      <input name="name" placeholder="Name" required defaultValue={person?.name} className="rounded border p-2" />
      <input name="age" type="number" placeholder="Age" required defaultValue={person?.age} className="rounded border p-2" />
      <select name="sex" defaultValue={person?.sex ?? 'male'} className="rounded border p-2">
        <option value="male">male</option><option value="female">female</option>
      </select>
      <input name="weightKg" type="number" step="0.5" placeholder="Weight (kg)" required defaultValue={person?.weightKg} className="rounded border p-2" />
      <input name="heightCm" type="number" placeholder="Height (cm)" required defaultValue={person?.heightCm} className="rounded border p-2" />
      <select name="activity" defaultValue={person?.activity ?? 'moderate'} className="rounded border p-2">
        <option value="sedentary">sedentary</option><option value="light">light</option>
        <option value="moderate">moderate</option><option value="active">active</option>
        <option value="very_active">very active</option>
      </select>
      <select name="goal" defaultValue={person?.goal ?? 'maintain'} className="rounded border p-2">
        <option value="maintain">maintain</option><option value="lose">lose</option><option value="gain">gain</option>
      </select>
      <input name="allergies" placeholder="Allergies (comma-separated)" defaultValue={person?.allergies.join(', ')} className="rounded border p-2" />
      <input name="dislikes" placeholder="Dislikes (comma-separated)" defaultValue={person?.dislikes.join(', ')} className="rounded border p-2" />
      <button className="col-span-2 rounded bg-emerald-700 p-2 text-white">{person ? 'Save changes' : 'Save person'}</button>
    </form>
  );
}
```

- [ ] **Step 2: Use it for the "Add person" section in the page**

In `src/app/(app)/family/page.tsx`, add the import near the other imports:

```tsx
import { PersonForm } from './PersonForm';
```

Replace the entire inline add `<form action={savePerson} …>…</form>` block (the nine inputs + "Save person" button) inside the "Add person" section with:

```tsx
        <PersonForm />
```

So that section reads:

```tsx
      <section className="rounded border p-4">
        <h2 className="mb-2 font-semibold">Add person</h2>
        <PersonForm />
      </section>
```

Then remove `savePerson` from the `@/app/actions/family` import (it is no longer referenced directly in the page — `PersonForm` owns it). The import becomes:

```tsx
import { addStaple, deletePerson, removeStaple, saveSettings } from '@/app/actions/family';
```

- [ ] **Step 3: Verify type-check and build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean. No "savePerson declared but never used" error in the page.

- [ ] **Step 4: Manual check (add still works)**

Run: `npm run dev`, open `/family`, add a new person via the form, confirm the new card appears with correct macro line. (Requires `.env.local` with `DATABASE_URL`.)

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/family/PersonForm.tsx src/app/\(app\)/family/page.tsx
git commit -m "refactor: shared PersonForm component for add"
```

---

## Task 5: inline edit via <details>

**Files:**
- Modify: `src/app/(app)/family/page.tsx`

**Interfaces:**
- Consumes: `PersonForm` (edit mode via `person` prop) from `./PersonForm`; the per-person row `p` already mapped in the list.

- [ ] **Step 1: Add an Edit disclosure to each person card**

In `src/app/(app)/family/page.tsx`, inside the `household.map((p) => …)` `<li>`, after the allergies/dislikes paragraphs (just before the closing `</li>`), add:

```tsx
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm text-emerald-700">Edit</summary>
                  <div className="mt-2">
                    <PersonForm person={p} />
                  </div>
                </details>
```

The card's existing `remove` form and the macro summary line stay unchanged. `<details>` is collapsed by default (no `open` attribute).

- [ ] **Step 2: Verify type-check and build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean. `p` from `db.select().from(people)` matches `PersonForm`'s `person` prop type (`typeof people.$inferSelect`).

- [ ] **Step 3: Verify the full suite still passes**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 4: Manual end-to-end check**

Run: `npm run dev`, open `/family`:
1. Click **Edit** on a person → the pre-filled form expands (selects show current sex/activity/goal; allergies/dislikes comma-joined).
2. Change weight + goal, click **Save changes** → card collapses, macro summary line recalculates with the new values, no duplicate card created.
3. Confirm **Add person** still inserts a new person.
4. Confirm **remove** still deletes.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/family/page.tsx
git commit -m "feat: inline edit for family members via <details>"
```

---

## Self-Review Notes

- **Spec coverage:** shared `PersonForm` (§1 → Task 4), `<details>` inline edit (§2 → Task 5), testable people service (§3 → Tasks 2–3), PGlite harness + integration tests (Testing section → Tasks 1–2), full verification (build/tsc/manual → Tasks 3–5). All spec sections map to a task.
- **Type consistency:** `PersonInput` (Task 2) is consumed verbatim in Task 3; `Person = typeof people.$inferSelect` is the `PersonForm` prop type (Task 4) and is exactly what `household.map`'s `p` is (Task 5); `createTestDb` (Task 1) signature matches its use in Task 2.
- **No new validation surface:** edit reuses the add form's `required` attributes and the action's numeric coercion + `list()` helper — identical to existing behaviour.
