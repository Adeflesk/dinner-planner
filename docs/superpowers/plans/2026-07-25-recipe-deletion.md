# Recipe Deletion from the Detail Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a recipe be deleted from its detail page, and loosen the delete guard so a recipe with only past cooking history is deletable (today it's blocked forever if it's ever been planned, even once, in any week).

**Architecture:** A new `deleteRecipe(db, id, now?)` service function in `src/lib/services/recipes.ts` owns the current/future guard and the cascading delete of the recipe's own past `planned_dinners` rows. The existing list-page action is renamed to free up that name and now delegates to the service; a new detail-page action wraps the same service with different redirect/feedback behavior. The detail page gains a three-state, no-JS delete control driven by search params.

**Tech Stack:** Next.js 16 App Router (server components, server actions), Drizzle ORM, Vitest + PGlite for service tests.

**Spec:** `docs/superpowers/specs/2026-07-24-recipe-deletion-design.md`

## Global Constraints

- **No delete button added to AI-suggested rows on the list page.** Only the detail page gets a new delete control.
- **No schema change.** Do NOT touch `src/lib/db/schema.ts`; never run `db:generate`/`db:push`. No `onDelete` cascade is added to the `planned_dinners.recipe_id → recipes.id` FK — cascading is done at the application layer.
- **No database transaction.** The two deletes (past `planned_dinners` rows, then the recipe) are sequential awaited statements, not wrapped in `db.transaction()` — this codebase has no transaction precedent and the app has no realistic concurrent writers.
- **No client-side JS.** Server components and plain forms/links only — no `'use client'`.
- **The list page's existing "remove" button keeps its current silent-on-blocked UX** from the caller's point of view — only the underlying rule loosens (past-only history no longer blocks it).
- Services take `Db` (from `@/lib/db`) as their first parameter; tests run on PGlite via `createTestDb()` from `@/lib/test/db` and need no env vars.
- UI layer (actions + pages) is verified by typecheck + build, not unit tests, per repo convention.

---

### Task 1: `deleteRecipe` service — current/future guard, cascading past-only delete

**Files:**
- Modify: `src/lib/services/recipes.ts`
- Test: `src/lib/services/recipes.test.ts`

**Interfaces:**
- Consumes: `plannedDinners`, `weekPlans`, `recipes` tables; `and`, `eq`, `gte` from `drizzle-orm`; `currentWeekStart` from `./dates` — all already imported in `recipes.ts`.
- Produces: `deleteRecipe(db: Db, id: string, now?: Date): Promise<'deleted' | 'blocked'>`. Task 2's actions call it.

- [ ] **Step 1: Write the failing tests**

In `src/lib/services/recipes.test.ts`, change the import from `./recipes` to include `deleteRecipe`:

```ts
import { deleteRecipe, recipeHistory, updateRecipe, type RecipeEditInput } from './recipes';
```

Append to the end of the file (after the `recipeHistory` `describe` block). This reuses `seedRecipe`, `seedPlannedWeek`, `listExists`, `NOW`, `PAST_WEEK`, and `CURRENT_WEEK`, all already defined earlier in this file:

```ts
async function plannedCountFor(db: Db, recipeId: string) {
  const rows = await db.select().from(plannedDinners).where(eq(plannedDinners.recipeId, recipeId));
  return rows.length;
}

async function recipeExists(db: Db, id: string) {
  const [row] = await db.select().from(recipes).where(eq(recipes.id, id));
  return row !== undefined;
}

describe('deleteRecipe', () => {
  it('deletes a recipe whose only history is in a past week', async () => {
    const db = await createTestDb();
    const seeded = await seedRecipe(db);
    const pastList = await seedPlannedWeek(db, PAST_WEEK, seeded.id);
    const result = await deleteRecipe(db, seeded.id, NOW);
    expect(result).toBe('deleted');
    expect(await recipeExists(db, seeded.id)).toBe(false);
    expect(await plannedCountFor(db, seeded.id)).toBe(0);
    expect(await listExists(db, pastList)).toBe(true); // that week's shopping list survives
  });

  it('deletes a recipe with no planned_dinners history at all', async () => {
    const db = await createTestDb();
    const seeded = await seedRecipe(db);
    const result = await deleteRecipe(db, seeded.id, NOW);
    expect(result).toBe('deleted');
    expect(await recipeExists(db, seeded.id)).toBe(false);
  });

  it('blocks deleting a recipe planned in the current week', async () => {
    const db = await createTestDb();
    const seeded = await seedRecipe(db);
    await seedPlannedWeek(db, CURRENT_WEEK, seeded.id);
    const result = await deleteRecipe(db, seeded.id, NOW);
    expect(result).toBe('blocked');
    expect(await recipeExists(db, seeded.id)).toBe(true);
    expect(await plannedCountFor(db, seeded.id)).toBe(1);
  });

  it('blocks deleting a recipe planned in a future week', async () => {
    const db = await createTestDb();
    const seeded = await seedRecipe(db);
    await seedPlannedWeek(db, '2026-07-20', seeded.id); // after CURRENT_WEEK
    const result = await deleteRecipe(db, seeded.id, NOW);
    expect(result).toBe('blocked');
    expect(await recipeExists(db, seeded.id)).toBe(true);
  });

  it('blocks deleting a recipe with both a past and a current occurrence — the past row survives too', async () => {
    const db = await createTestDb();
    const seeded = await seedRecipe(db);
    await seedPlannedWeek(db, PAST_WEEK, seeded.id);
    await seedPlannedWeek(db, CURRENT_WEEK, seeded.id);
    const result = await deleteRecipe(db, seeded.id, NOW);
    expect(result).toBe('blocked');
    expect(await recipeExists(db, seeded.id)).toBe(true);
    expect(await plannedCountFor(db, seeded.id)).toBe(2);
  });

  it('is a no-op for an unknown id', async () => {
    const db = await createTestDb();
    const seeded = await seedRecipe(db);
    const result = await deleteRecipe(db, '00000000-0000-0000-0000-000000000000', NOW);
    expect(result).toBe('deleted');
    expect(await recipeExists(db, seeded.id)).toBe(true);
  });

  it("does not touch a different recipe's planned_dinners rows or shopping lists", async () => {
    const db = await createTestDb();
    const seeded = await seedRecipe(db);
    const other = await seedRecipe(db);
    const otherList = await seedPlannedWeek(db, PAST_WEEK, other.id);
    await deleteRecipe(db, seeded.id, NOW);
    expect(await recipeExists(db, other.id)).toBe(true);
    expect(await plannedCountFor(db, other.id)).toBe(1);
    expect(await listExists(db, otherList)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/services/recipes.test.ts`
Expected: FAIL — `deleteRecipe` is not exported from `./recipes`. The 10 pre-existing tests still pass.

- [ ] **Step 3: Implement**

Append to the end of `src/lib/services/recipes.ts`, after `recipeHistory`:

```ts
/**
 * Delete a recipe, unless it's planned in the current week or a later one.
 * Deletes the recipe's own (necessarily past-only) planned_dinners rows
 * first, to satisfy the FK, then the recipe row itself.
 */
export async function deleteRecipe(db: Db, id: string, now: Date = new Date()): Promise<'deleted' | 'blocked'> {
  const upcoming = await db.select({ id: plannedDinners.id })
    .from(plannedDinners)
    .innerJoin(weekPlans, eq(plannedDinners.weekPlanId, weekPlans.id))
    .where(and(eq(plannedDinners.recipeId, id), gte(weekPlans.weekStart, currentWeekStart(now))))
    .limit(1);
  if (upcoming.length > 0) return 'blocked';

  await db.delete(plannedDinners).where(eq(plannedDinners.recipeId, id));
  await db.delete(recipes).where(eq(recipes.id, id));
  return 'deleted';
}
```

No new imports are needed — `and`, `eq`, `gte`, `plannedDinners`, `weekPlans`, `recipes`, and `currentWeekStart` are already imported at the top of the file.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/services/recipes.test.ts`
Expected: PASS (17 tests — 10 pre-existing + 7 new).

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/recipes.ts src/lib/services/recipes.test.ts
git commit -m "feat: deleteRecipe service — blocks only on current/future plans"
```

---

### Task 2: Actions — rename to `deleteRecipeAction`, add `deleteRecipeFromDetailAction`

**Files:**
- Modify: `src/app/actions/recipes.ts`
- Modify: `src/app/(app)/recipes/page.tsx`

**Interfaces:**
- Consumes: `deleteRecipe(db, id, now?)` from `@/lib/services/recipes` (Task 1).
- Produces: `deleteRecipeAction(formData)` (renamed from the current `deleteRecipe`, same behavior) and `deleteRecipeFromDetailAction(formData)`. Task 3's detail page calls the latter.

- [ ] **Step 1: Rename and rebuild the list-page action**

In `src/app/actions/recipes.ts`, change the service import:

```ts
import { updateRecipe } from '@/lib/services/recipes';
```

to:

```ts
import { deleteRecipe, updateRecipe } from '@/lib/services/recipes';
```

Replace the existing `deleteRecipe` action:

```ts
export async function deleteRecipe(formData: FormData) {
  const db = getDb();
  const id = String(formData.get('id'));
  // Guard: refuse to delete a recipe that is currently planned (FK constraint)
  const { plannedDinners } = await import('@/lib/db/schema');
  const [inUse] = await db.select().from(plannedDinners).where(eq(plannedDinners.recipeId, id)).limit(1);
  if (inUse) return; // silently skip — UI can surface this if needed
  await db.delete(recipes).where(eq(recipes.id, id));
  revalidatePath('/recipes');
}
```

with:

```ts
export async function deleteRecipeAction(formData: FormData) {
  await deleteRecipe(getDb(), String(formData.get('id')));
  revalidatePath('/recipes');
}
```

- [ ] **Step 2: Add the detail-page delete action**

Append to the end of `src/app/actions/recipes.ts`, after `updateRecipeAction`:

```ts
export async function deleteRecipeFromDetailAction(formData: FormData) {
  const id = String(formData.get('id'));
  if (!UUID_RE.test(id)) return; // malformed id — return without changes
  const result = await deleteRecipe(getDb(), id);
  if (result === 'blocked') redirect(`/recipes/${id}?blocked=planned`);
  revalidatePath('/recipes');
  redirect('/recipes');
}
```

- [ ] **Step 3: Update the list page's call site**

In `src/app/(app)/recipes/page.tsx`, change the import:

```ts
import { deleteRecipe, promoteToFavourite, saveRecipe } from '@/app/actions/recipes';
```

to:

```ts
import { deleteRecipeAction, promoteToFavourite, saveRecipe } from '@/app/actions/recipes';
```

and change:

```tsx
                <form action={deleteRecipe}>
```

to:

```tsx
                <form action={deleteRecipeAction}>
```

- [ ] **Step 4: Typecheck and build**

Run: `npm run build && npx tsc --noEmit`
Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add src/app/actions/recipes.ts "src/app/(app)/recipes/page.tsx"
git commit -m "feat: rename deleteRecipe action to deleteRecipeAction; add deleteRecipeFromDetailAction"
```

---

### Task 3: Detail page — delete control (default / confirm / blocked states)

**Files:**
- Modify: `src/app/(app)/recipes/[id]/page.tsx`

**Interfaces:**
- Consumes: `deleteRecipeFromDetailAction` from `@/app/actions/recipes` (Task 2).
- Produces: nothing new — page behavior only.

- [ ] **Step 1: Add `searchParams` and the delete control**

In `src/app/(app)/recipes/[id]/page.tsx`, change the import:

```ts
import { promoteToFavourite, updateRecipeAction } from '@/app/actions/recipes';
```

to:

```ts
import { deleteRecipeFromDetailAction, promoteToFavourite, updateRecipeAction } from '@/app/actions/recipes';
```

Change the component signature and its first lines:

```tsx
export default async function RecipeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const db = getDb();
  const [recipe] = await db.select().from(recipes).where(eq(recipes.id, id));
  if (!recipe) notFound();
  const history = await recipeHistory(db, id);
```

to:

```tsx
export default async function RecipeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ confirmDelete?: string; blocked?: string }>;
}) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const { confirmDelete, blocked } = await searchParams;
  const db = getDb();
  const [recipe] = await db.select().from(recipes).where(eq(recipes.id, id));
  if (!recipe) notFound();
  const history = await recipeHistory(db, id);
```

Then, inside the first `<section>`, insert the delete control right after the macros `<p>` and before the closing `</section>`. The macros paragraph and the section's closing tag currently read:

```tsx
          {recipe.equipment.map((e) => (
            <span key={e} className="rounded-full bg-bottle-soft px-2 py-0.5 text-bottle">{e}</span>
          ))}
        </p>
      </section>
```

Change to:

```tsx
          {recipe.equipment.map((e) => (
            <span key={e} className="rounded-full bg-bottle-soft px-2 py-0.5 text-bottle">{e}</span>
          ))}
        </p>
        {blocked === 'planned' ? (
          <p className="mt-2 text-xs text-tomato">Can&apos;t delete — this recipe is planned this week or later.</p>
        ) : confirmDelete ? (
          <div className="mt-2 flex items-center gap-3 text-xs">
            <span className="text-soft">Delete this recipe? This can&apos;t be undone.</span>
            <form action={deleteRecipeFromDetailAction}>
              <input type="hidden" name="id" value={recipe.id} />
              <button className="text-tomato underline underline-offset-3">Yes, delete</button>
            </form>
            <Link href={`/recipes/${recipe.id}`} className="text-soft hover:text-bottle">Cancel</Link>
          </div>
        ) : (
          <Link href={`/recipes/${recipe.id}?confirmDelete=1`} className="mt-2 inline-block text-xs text-soft hover:text-tomato">
            Delete recipe
          </Link>
        )}
      </section>
```

- [ ] **Step 2: Typecheck and build**

Run: `npm run build && npx tsc --noEmit`
Expected: both succeed.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/recipes/[id]/page.tsx"
git commit -m "feat: delete recipe from the detail page, with confirm and blocked states"
```

---

### Task 4: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including the extended `recipes.test.ts` (17 tests). 152 total (145 baseline + 7 new).

- [ ] **Step 2: Production build + typecheck**

Run: `npm run build && npx tsc --noEmit`
Expected: both succeed.

- [ ] **Step 3: Verify no schema drift**

Run: `git status --short src/lib/db/`
Expected: no output — the schema was never touched, so no `db:generate`/`db:push` is needed.
