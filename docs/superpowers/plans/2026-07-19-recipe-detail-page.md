# Recipe Detail Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-recipe page at `/recipes/[id]` showing full details, cooking history from past week plans, and an edit form with AI re-estimation ticked by default.

**Architecture:** A new `src/lib/services/recipes.ts` service owns updating a recipe (section carry-over, optional AI estimate, shopping-list invalidation for current/future planned weeks) and the history query. A thin server action wraps it; the detail page is a server component with plain forms. The list page's recipe names become links and lose their inline `<details>`.

**Tech Stack:** Next.js 16 App Router (server components, server actions), Drizzle ORM, Vitest + PGlite for service tests, AI SDK v6 `generateObject` behind the existing injectable-estimator pattern (tests always fake it).

**Spec:** `docs/superpowers/specs/2026-07-19-recipe-detail-page-design.md`

## Global Constraints

- **No schema change.** Do NOT touch `src/lib/db/schema.ts`; never run `db:generate`/`db:push`.
- **No client-side JS.** Server components and plain forms only — no `'use client'`.
- **No new dependencies.**
- Day indexing: **0 = Monday … 6 = Sunday**; `weekStart` is a Monday `YYYY-MM-DD` (UTC).
- An edit **never changes `source` or `createdAt`** — editing an AI recipe does not promote it.
- An edit **never fails to save** because AI is down — silent fallback to typed values.
- Services take `Db` (from `@/lib/db`) as their first parameter; tests run on PGlite via `createTestDb()` from `@/lib/test/db` and need no env vars.
- UI layer (action + pages) is verified by typecheck + build, not unit tests, per repo convention.

---

### Task 1: `formatIngredientLines` — inverse of the ingredient parser

**Files:**
- Modify: `src/lib/services/ingredients.ts`
- Test: `src/lib/services/ingredients.test.ts`

**Interfaces:**
- Consumes: `Ingredient` type from `@/lib/macro/types` (`{ name, quantity, unit, section }`).
- Produces: `formatIngredientLines(ingredients: Ingredient[]): string` — one `"{quantity} {unit} {name}"` line per ingredient, `\n`-joined. Task 6's detail page uses it to prefill the edit textarea.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/services/ingredients.test.ts` (and add `formatIngredientLines` to the existing import from `./ingredients`):

```ts
describe('formatIngredientLines', () => {
  it('renders one "qty unit name" line per ingredient', () => {
    expect(formatIngredientLines([
      { name: 'chicken breast', quantity: 500, unit: 'g', section: 'meat_fish' },
      { name: 'onion', quantity: 2, unit: 'pcs', section: 'produce' },
    ])).toBe('500 g chicken breast\n2 pcs onion');
  });

  it('round-trips through parseIngredientLines (name, quantity, unit preserved)', () => {
    const original = [
      { name: 'olive oil', quantity: 1.5, unit: 'tbsp', section: 'pantry' as const },
      { name: 'lemon', quantity: 1, unit: 'pcs', section: 'produce' as const },
    ];
    const reparsed = parseIngredientLines(formatIngredientLines(original));
    expect(reparsed.map(({ name, quantity, unit }) => ({ name, quantity, unit }))).toEqual(
      original.map(({ name, quantity, unit }) => ({ name, quantity, unit })),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/services/ingredients.test.ts`
Expected: FAIL — `formatIngredientLines` is not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/services/ingredients.ts`:

```ts
/** Inverse of parseIngredientLines: "{quantity} {unit} {name}" per line, for prefilling edit forms. */
export function formatIngredientLines(ingredients: Ingredient[]): string {
  return ingredients.map((i) => `${i.quantity} ${i.unit} ${i.name}`).join('\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/services/ingredients.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/ingredients.ts src/lib/services/ingredients.test.ts
git commit -m "feat: formatIngredientLines, inverse of the ingredient-line parser"
```

---

### Task 2: `updateRecipe` service — field patch with section carry-over

**Files:**
- Create: `src/lib/services/recipes.ts`
- Test: `src/lib/services/recipes.test.ts`

**Interfaces:**
- Consumes: `parseIngredientLines` from `./ingredients`; `canonicalName(name: string): string` from `@/lib/macro/canon`; `recipes` table from `@/lib/db/schema`.
- Produces: `RecipeEditInput` type and `updateRecipe(db: Db, id: string, input: RecipeEditInput): Promise<void>`. Tasks 3–4 extend this same function (AI path, invalidation); Task 6's action calls it.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/services/recipes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@/lib/test/db';
import type { Db } from '@/lib/db';
import { recipes } from '@/lib/db/schema';
import { updateRecipe, type RecipeEditInput } from './recipes';

/** A stored family recipe whose ingredients carry real store sections. */
async function seedRecipe(db: Db) {
  const [recipe] = await db.insert(recipes).values({
    name: 'Roast chicken',
    cuisine: 'british',
    method: 'Roast it.',
    servings: 4,
    perServing: { kcal: 560, protein: 40, carbs: 55, fat: 20 },
    tags: ['comfort'],
    equipment: ['oven'],
    source: 'family',
    ingredients: [
      { name: 'chicken breast', quantity: 500, unit: 'g', section: 'meat_fish' },
      { name: 'green onion', quantity: 2, unit: 'pcs', section: 'produce' },
    ],
  }).returning();
  return recipe;
}

/** Baseline edit input mirroring the seeded recipe (no changes, AI off). */
function baseInput(): RecipeEditInput {
  return {
    name: 'Roast chicken',
    cuisine: 'british',
    servings: 4,
    ingredientLines: '500 g chicken breast\n2 pcs green onion',
    method: 'Roast it.',
    tags: ['comfort'],
    perServing: { kcal: 560, protein: 40, carbs: 55, fat: 20 },
    equipment: ['oven'],
    useAi: false,
  };
}

describe('updateRecipe', () => {
  it('patches scalar fields, tags and equipment; source and createdAt unchanged', async () => {
    const db = await createTestDb();
    const seeded = await seedRecipe(db);
    await updateRecipe(db, seeded.id, {
      ...baseInput(),
      name: 'Sunday roast chicken',
      cuisine: 'irish',
      method: 'Roast it slowly.',
      tags: ['comfort', 'weekend'],
      perServing: { kcal: 600, protein: 42, carbs: 58, fat: 22 },
      equipment: ['oven', 'hob'],
    });
    const [updated] = await db.select().from(recipes).where(eq(recipes.id, seeded.id));
    expect(updated.name).toBe('Sunday roast chicken');
    expect(updated.cuisine).toBe('irish');
    expect(updated.method).toBe('Roast it slowly.');
    expect(updated.tags).toEqual(['comfort', 'weekend']);
    expect(updated.perServing).toEqual({ kcal: 600, protein: 42, carbs: 58, fat: 22 });
    expect(updated.equipment).toEqual(['oven', 'hob']);
    expect(updated.source).toBe('family');
    expect(updated.createdAt).toEqual(seeded.createdAt);
  });

  it('keeps stored store sections for surviving ingredients, matched canonically', async () => {
    const db = await createTestDb();
    const seeded = await seedRecipe(db);
    // "scallion" is a synonym of stored "green onion"; "lemon" is new.
    await updateRecipe(db, seeded.id, {
      ...baseInput(),
      ingredientLines: '400 g chicken breast\n3 pcs scallion\n1 pcs lemon',
    });
    const [updated] = await db.select().from(recipes).where(eq(recipes.id, seeded.id));
    expect(updated.ingredients).toEqual([
      { name: 'chicken breast', quantity: 400, unit: 'g', section: 'meat_fish' },
      { name: 'scallion', quantity: 3, unit: 'pcs', section: 'produce' },
      { name: 'lemon', quantity: 1, unit: 'pcs', section: 'other' },
    ]);
  });

  it('is a no-op for an unknown id', async () => {
    const db = await createTestDb();
    const seeded = await seedRecipe(db);
    await updateRecipe(db, '00000000-0000-0000-0000-000000000000', { ...baseInput(), name: 'X' });
    const [row] = await db.select().from(recipes).where(eq(recipes.id, seeded.id));
    expect(row.name).toBe('Roast chicken');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/services/recipes.test.ts`
Expected: FAIL — cannot resolve `./recipes`.

- [ ] **Step 3: Implement**

Create `src/lib/services/recipes.ts`:

```ts
import { eq } from 'drizzle-orm';
import type { Db } from '@/lib/db';
import { recipes } from '@/lib/db/schema';
import type { Ingredient, MacroSet } from '@/lib/macro/types';
import { canonicalName } from '@/lib/macro/canon';
import { parseIngredientLines } from './ingredients';

export type RecipeEditInput = {
  name: string;
  cuisine: string;
  servings: number;
  ingredientLines: string;
  method: string;
  tags: string[];
  perServing: MacroSet;
  equipment: string[];
  useAi: boolean;
};

// parseIngredientLines assigns every line section 'other'; keep the stored
// section for ingredients that survive the edit (matched canonically).
function carrySections(parsed: Ingredient[], previous: Ingredient[]): Ingredient[] {
  const sections = new Map(previous.map((i) => [canonicalName(i.name), i.section]));
  return parsed.map((i) => ({ ...i, section: sections.get(canonicalName(i.name)) ?? i.section }));
}

/** Update a recipe in place. `source` and `createdAt` are never touched. */
export async function updateRecipe(db: Db, id: string, input: RecipeEditInput): Promise<void> {
  const [existing] = await db.select().from(recipes).where(eq(recipes.id, id));
  if (!existing) return;

  const ingredients = carrySections(parseIngredientLines(input.ingredientLines), existing.ingredients);

  await db.update(recipes).set({
    name: input.name,
    cuisine: input.cuisine,
    method: input.method,
    servings: input.servings,
    perServing: input.perServing,
    tags: input.tags,
    equipment: input.equipment,
    ingredients,
  }).where(eq(recipes.id, id));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/services/recipes.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/recipes.ts src/lib/services/recipes.test.ts
git commit -m "feat: updateRecipe service with canonical section carry-over"
```

---

### Task 3: AI re-estimation path in `updateRecipe`

**Files:**
- Modify: `src/lib/services/recipes.ts`
- Test: `src/lib/services/recipes.test.ts`

**Interfaces:**
- Consumes: `estimateRecipe(input, est): Promise<MacroEstimate | null>`, `aiEstimator`, and `Estimator` type from `@/lib/ai/recipes`; `CAPABILITIES` and `Capability` from `@/lib/macro/equipment`.
- Produces: `updateRecipe(db: Db, id: string, input: RecipeEditInput, est?: Estimator): Promise<void>` — new optional 4th parameter, defaulting to `aiEstimator`. Tests pass fakes; production code never passes it.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/services/recipes.test.ts` (add to the imports: `import type { Estimator } from '@/lib/ai/recipes';`):

```ts
// kcal = 4*45 + 4*30 + 9*18 = 462 — satisfies the energyConsistent gate.
const fakeEstimator: Estimator = async () => ({
  perServing: { kcal: 462, protein: 45, carbs: 30, fat: 18 },
  equipment: ['steam'],
  ingredients: [{ name: 'salmon', quantity: 400, unit: 'g', section: 'meat_fish' as const }],
});

const failingEstimator: Estimator = async () => { throw new Error('AI down'); };

describe('updateRecipe with AI estimation', () => {
  it('AI estimate overrides typed macros, ingredients and equipment', async () => {
    const db = await createTestDb();
    const seeded = await seedRecipe(db);
    await updateRecipe(db, seeded.id, { ...baseInput(), useAi: true }, fakeEstimator);
    const [updated] = await db.select().from(recipes).where(eq(recipes.id, seeded.id));
    expect(updated.perServing).toEqual({ kcal: 462, protein: 45, carbs: 30, fat: 18 });
    expect(updated.ingredients).toEqual([
      { name: 'salmon', quantity: 400, unit: 'g', section: 'meat_fish' },
    ]);
    expect(updated.equipment).toEqual(['steam']);
  });

  it('falls back to typed values when AI fails — the edit still saves', async () => {
    const db = await createTestDb();
    const seeded = await seedRecipe(db);
    await updateRecipe(
      db, seeded.id,
      { ...baseInput(), name: 'Renamed anyway', ingredientLines: '400 g chicken breast', useAi: true },
      failingEstimator,
    );
    const [updated] = await db.select().from(recipes).where(eq(recipes.id, seeded.id));
    expect(updated.name).toBe('Renamed anyway');
    expect(updated.ingredients).toEqual([
      { name: 'chicken breast', quantity: 400, unit: 'g', section: 'meat_fish' },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/services/recipes.test.ts`
Expected: the two new tests FAIL (first: macros still 560; the estimator is never called). The three Task 2 tests still pass.

- [ ] **Step 3: Implement**

In `src/lib/services/recipes.ts`, add imports:

```ts
import { aiEstimator, estimateRecipe, type Estimator } from '@/lib/ai/recipes';
import { CAPABILITIES, type Capability } from '@/lib/macro/equipment';
```

Replace `updateRecipe` with:

```ts
/** Update a recipe in place. `source` and `createdAt` are never touched. */
export async function updateRecipe(
  db: Db,
  id: string,
  input: RecipeEditInput,
  est: Estimator = aiEstimator,
): Promise<void> {
  const [existing] = await db.select().from(recipes).where(eq(recipes.id, id));
  if (!existing) return;

  let perServing = input.perServing;
  let ingredients = carrySections(parseIngredientLines(input.ingredientLines), existing.ingredients);
  let equipment = input.equipment;

  if (input.useAi) {
    const estimate = await estimateRecipe(
      { name: input.name, servings: input.servings, ingredientLines: input.ingredientLines },
      est,
    );
    if (estimate) {
      perServing = estimate.perServing;
      ingredients = estimate.ingredients;
      const valid = estimate.equipment.filter((e): e is Capability => (CAPABILITIES as readonly string[]).includes(e));
      if (valid.length > 0) equipment = valid;
    }
    // AI down — fall back to what was typed, never block saving
  }

  await db.update(recipes).set({
    name: input.name,
    cuisine: input.cuisine,
    method: input.method,
    servings: input.servings,
    perServing,
    tags: input.tags,
    equipment,
    ingredients,
  }).where(eq(recipes.id, id));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/services/recipes.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/recipes.ts src/lib/services/recipes.test.ts
git commit -m "feat: AI re-estimation path in updateRecipe with typed-value fallback"
```

---

### Task 4: Shopping-list invalidation for current/future planned weeks

**Files:**
- Modify: `src/lib/services/recipes.ts`
- Test: `src/lib/services/recipes.test.ts`

**Interfaces:**
- Consumes: `currentWeekStart(now?: Date): string` from `./dates`; `plannedDinners`, `shoppingLists`, `weekPlans` tables from `@/lib/db/schema`.
- Produces: `updateRecipe(db: Db, id: string, input: RecipeEditInput, est?: Estimator, now?: Date): Promise<void>` — new optional 5th parameter (defaults `new Date()`), used only to decide which weeks count as current/future. This is the final signature.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/services/recipes.test.ts` (add to the schema import: `plannedDinners, shoppingLists, weekPlans`):

```ts
// 2026-07-16 is a Thursday; its week's Monday is 2026-07-13.
const NOW = new Date('2026-07-16T12:00:00Z');
const PAST_WEEK = '2026-06-29';
const CURRENT_WEEK = '2026-07-13';

/** Plan `recipeId` in `weekStart` and give that week a shopping list. Returns the list id. */
async function seedPlannedWeek(db: Db, weekStart: string, recipeId: string) {
  const [plan] = await db.insert(weekPlans).values({ weekStart }).returning();
  await db.insert(plannedDinners).values({
    weekPlanId: plan.id, day: 0, recipeId, householdServings: 4, portions: [],
  });
  const [list] = await db.insert(shoppingLists).values({
    weekPlanId: plan.id,
    items: [{ name: 'chicken breast', quantity: 500, unit: 'g', section: 'meat_fish', checked: false, manual: false }],
  }).returning();
  return list.id;
}

async function listExists(db: Db, listId: string) {
  const [row] = await db.select().from(shoppingLists).where(eq(shoppingLists.id, listId));
  return row !== undefined;
}

describe('updateRecipe shopping-list invalidation', () => {
  it('an ingredient change deletes lists only for current/future weeks containing the recipe', async () => {
    const db = await createTestDb();
    const seeded = await seedRecipe(db);
    const other = await seedRecipe(db); // a second, unrelated recipe
    const pastList = await seedPlannedWeek(db, PAST_WEEK, seeded.id);
    const currentList = await seedPlannedWeek(db, CURRENT_WEEK, seeded.id);
    const unrelatedList = await seedPlannedWeek(db, '2026-07-20', other.id);

    await updateRecipe(db, seeded.id, {
      ...baseInput(),
      ingredientLines: '600 g chicken breast\n2 pcs green onion',
    }, undefined, NOW);

    expect(await listExists(db, pastList)).toBe(true);       // history untouched
    expect(await listExists(db, currentList)).toBe(false);   // invalidated
    expect(await listExists(db, unrelatedList)).toBe(true);  // other recipe's week untouched
  });

  it('a servings change also invalidates', async () => {
    const db = await createTestDb();
    const seeded = await seedRecipe(db);
    const currentList = await seedPlannedWeek(db, CURRENT_WEEK, seeded.id);
    await updateRecipe(db, seeded.id, { ...baseInput(), servings: 6 }, undefined, NOW);
    expect(await listExists(db, currentList)).toBe(false);
  });

  it('a cosmetic edit (name, tags, method, macros) deletes nothing', async () => {
    const db = await createTestDb();
    const seeded = await seedRecipe(db);
    const currentList = await seedPlannedWeek(db, CURRENT_WEEK, seeded.id);
    await updateRecipe(db, seeded.id, {
      ...baseInput(),
      name: 'New name',
      tags: ['renamed'],
      method: 'Different words.',
      perServing: { kcal: 600, protein: 42, carbs: 58, fat: 22 },
    }, undefined, NOW);
    expect(await listExists(db, currentList)).toBe(true);
  });
});
```

Note for the first test: `seedRecipe` inserts a fixed name twice — that is fine, `recipes.name` has no unique constraint.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/services/recipes.test.ts`
Expected: the three new tests FAIL (`currentList` still exists / signature mismatch). Earlier tests still pass.

- [ ] **Step 3: Implement**

In `src/lib/services/recipes.ts`, change the drizzle import to `import { and, eq, gte, inArray } from 'drizzle-orm';`, the schema import to `import { plannedDinners, recipes, shoppingLists, weekPlans } from '@/lib/db/schema';`, and add `import { currentWeekStart } from './dates';`.

Change the signature and add change detection + invalidation (full final function):

```ts
/** Update a recipe in place. `source` and `createdAt` are never touched. */
export async function updateRecipe(
  db: Db,
  id: string,
  input: RecipeEditInput,
  est: Estimator = aiEstimator,
  now: Date = new Date(),
): Promise<void> {
  const [existing] = await db.select().from(recipes).where(eq(recipes.id, id));
  if (!existing) return;

  let perServing = input.perServing;
  let ingredients = carrySections(parseIngredientLines(input.ingredientLines), existing.ingredients);
  let equipment = input.equipment;

  if (input.useAi) {
    const estimate = await estimateRecipe(
      { name: input.name, servings: input.servings, ingredientLines: input.ingredientLines },
      est,
    );
    if (estimate) {
      perServing = estimate.perServing;
      ingredients = estimate.ingredients;
      const valid = estimate.equipment.filter((e): e is Capability => (CAPABILITIES as readonly string[]).includes(e));
      if (valid.length > 0) equipment = valid;
    }
    // AI down — fall back to what was typed, never block saving
  }

  const listsStale = input.servings !== existing.servings
    || JSON.stringify(ingredients) !== JSON.stringify(existing.ingredients);

  await db.update(recipes).set({
    name: input.name,
    cuisine: input.cuisine,
    method: input.method,
    servings: input.servings,
    perServing,
    tags: input.tags,
    equipment,
    ingredients,
  }).where(eq(recipes.id, id));

  if (listsStale) {
    // Same invalidation a re-plan performs, but only for weeks that still lie ahead.
    const affected = await db.select({ weekPlanId: plannedDinners.weekPlanId })
      .from(plannedDinners)
      .innerJoin(weekPlans, eq(plannedDinners.weekPlanId, weekPlans.id))
      .where(and(eq(plannedDinners.recipeId, id), gte(weekPlans.weekStart, currentWeekStart(now))));
    if (affected.length > 0) {
      await db.delete(shoppingLists)
        .where(inArray(shoppingLists.weekPlanId, affected.map((a) => a.weekPlanId)));
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/services/recipes.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/recipes.ts src/lib/services/recipes.test.ts
git commit -m "feat: ingredient/servings edits invalidate current and future shopping lists"
```

---

### Task 5: `recipeHistory` service

**Files:**
- Modify: `src/lib/services/recipes.ts`
- Test: `src/lib/services/recipes.test.ts`

**Interfaces:**
- Consumes: `plannedDinners`, `weekPlans` tables (already imported in Task 4); `desc` from `drizzle-orm`.
- Produces: `RecipeHistoryEntry = { weekStart: string; day: number; cookedOn: string }` and `recipeHistory(db: Db, recipeId: string): Promise<RecipeHistoryEntry[]>` — occurrences newest first, `cookedOn` = `weekStart` + `day` days as `YYYY-MM-DD`. Task 6's page renders this.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/services/recipes.test.ts` (add `recipeHistory` to the `./recipes` import):

```ts
describe('recipeHistory', () => {
  it('returns occurrences newest first with the cooked date computed from weekStart + day', async () => {
    const db = await createTestDb();
    const seeded = await seedRecipe(db);
    // Thu (day 3) of week 2026-06-29 → 2026-07-02; Mon (day 0) of week 2026-07-13.
    const [older] = await db.insert(weekPlans).values({ weekStart: '2026-06-29' }).returning();
    const [newer] = await db.insert(weekPlans).values({ weekStart: '2026-07-13' }).returning();
    await db.insert(plannedDinners).values([
      { weekPlanId: older.id, day: 3, recipeId: seeded.id, householdServings: 4, portions: [] },
      { weekPlanId: newer.id, day: 0, recipeId: seeded.id, householdServings: 4, portions: [] },
    ]);
    expect(await recipeHistory(db, seeded.id)).toEqual([
      { weekStart: '2026-07-13', day: 0, cookedOn: '2026-07-13' },
      { weekStart: '2026-06-29', day: 3, cookedOn: '2026-07-02' },
    ]);
  });

  it('is empty for a never-planned recipe', async () => {
    const db = await createTestDb();
    const seeded = await seedRecipe(db);
    expect(await recipeHistory(db, seeded.id)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/services/recipes.test.ts`
Expected: FAIL — `recipeHistory` is not exported.

- [ ] **Step 3: Implement**

In `src/lib/services/recipes.ts`, add `desc` to the drizzle import and append:

```ts
export type RecipeHistoryEntry = { weekStart: string; day: number; cookedOn: string };

/** Every planned occurrence of a recipe, newest first. cookedOn = weekStart + day (UTC). */
export async function recipeHistory(db: Db, recipeId: string): Promise<RecipeHistoryEntry[]> {
  const rows = await db.select({ weekStart: weekPlans.weekStart, day: plannedDinners.day })
    .from(plannedDinners)
    .innerJoin(weekPlans, eq(plannedDinners.weekPlanId, weekPlans.id))
    .where(eq(plannedDinners.recipeId, recipeId))
    .orderBy(desc(weekPlans.weekStart), desc(plannedDinners.day));
  return rows.map((r) => {
    const d = new Date(`${r.weekStart}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + r.day);
    return { ...r, cookedOn: d.toISOString().slice(0, 10) };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/services/recipes.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/recipes.ts src/lib/services/recipes.test.ts
git commit -m "feat: recipeHistory — planned occurrences of a recipe, newest first"
```

---

### Task 6: `updateRecipeAction` + the `/recipes/[id]` detail page

**Files:**
- Modify: `src/app/actions/recipes.ts`
- Create: `src/app/(app)/recipes/[id]/page.tsx`

**Interfaces:**
- Consumes: `updateRecipe`, `recipeHistory` from `@/lib/services/recipes`; `formatIngredientLines` from `@/lib/services/ingredients`; existing `promoteToFavourite` action; `CAPABILITIES` from `@/lib/macro/equipment`.
- Produces: server action `updateRecipeAction(formData: FormData)` (suffix avoids clashing with the imported service, same precedent as `markStapleAction`) and the page component. Task 7 links to this page.

- [ ] **Step 1: Add the server action**

In `src/app/actions/recipes.ts`, add imports:

```ts
import { redirect } from 'next/navigation';
import { updateRecipe } from '@/lib/services/recipes';
```

Append:

```ts
export async function updateRecipeAction(formData: FormData) {
  const id = String(formData.get('id'));
  await updateRecipe(getDb(), id, {
    name: String(formData.get('name')),
    cuisine: String(formData.get('cuisine')) || 'any',
    servings: Number(formData.get('servings')) || 4,
    ingredientLines: String(formData.get('ingredients')),
    method: String(formData.get('method') ?? ''),
    tags: String(formData.get('tags') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    perServing: {
      kcal: Number(formData.get('kcal')) || 0,
      protein: Number(formData.get('protein')) || 0,
      carbs: Number(formData.get('carbs')) || 0,
      fat: Number(formData.get('fat')) || 0,
    },
    equipment: formData.getAll('equipment').map(String),
    useAi: formData.get('estimateWithAi') === 'on',
  });
  revalidatePath('/recipes');
  revalidatePath(`/recipes/${id}`);
  revalidatePath('/shopping');
  revalidatePath('/'); // recipe names appear on the plan
  redirect(`/recipes/${id}`);
}
```

- [ ] **Step 2: Create the detail page**

Create `src/app/(app)/recipes/[id]/page.tsx`:

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { recipes } from '@/lib/db/schema';
import { CAPABILITIES } from '@/lib/macro/equipment';
import { formatIngredientLines } from '@/lib/services/ingredients';
import { recipeHistory } from '@/lib/services/recipes';
import { promoteToFavourite, updateRecipeAction } from '@/app/actions/recipes';

export const dynamic = 'force-dynamic';

// A non-UUID id would make the uuid-typed query throw; treat it as not found instead.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cookedDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  });
}

export default async function RecipeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const db = getDb();
  const [recipe] = await db.select().from(recipes).where(eq(recipes.id, id));
  if (!recipe) notFound();
  const history = await recipeHistory(db, id);

  return (
    <main className="space-y-9">
      <section>
        <Link href="/recipes" className="text-xs text-soft hover:text-bottle">← All recipes</Link>
        <div className="mt-1.5 flex items-start justify-between gap-3">
          <h1 className="font-display text-[27px]">{recipe.name}</h1>
          {recipe.source === 'ai' && (
            <form action={promoteToFavourite}>
              <input type="hidden" name="id" value={recipe.id} />
              <button className="text-xs text-bottle underline underline-offset-3">Save as favourite</button>
            </form>
          )}
        </div>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-data text-xs text-soft">
          <span>{recipe.source === 'ai' ? 'AI-suggested' : 'family favourite'}</span>
          <span>{recipe.cuisine}</span>
          <span>{recipe.servings} servings</span>
          <span>{Math.round(recipe.perServing.kcal)} kcal</span>
          <span>
            P{Math.round(recipe.perServing.protein)} C{Math.round(recipe.perServing.carbs)} F{Math.round(recipe.perServing.fat)}
          </span>
          {recipe.tags.includes('vegetarian') && <span className="text-bottle">veg</span>}
          {recipe.equipment.map((e) => (
            <span key={e} className="rounded-full bg-bottle-soft px-2 py-0.5 text-bottle">{e}</span>
          ))}
        </p>
      </section>

      <section className="card p-5 text-sm">
        <h2 className="eyebrow mb-2.5">Ingredients</h2>
        <ul className="ml-4 list-disc">
          {recipe.ingredients.map((i, idx) => (
            <li key={idx}>
              <span className="font-data text-[13px]">{i.quantity} {i.unit}</span> {i.name}
            </li>
          ))}
        </ul>
        {recipe.method && (
          <>
            <h2 className="eyebrow mt-4 mb-1.5">Method</h2>
            <p className="whitespace-pre-wrap text-soft">{recipe.method}</p>
          </>
        )}
      </section>

      <section>
        <h2 className="eyebrow mb-2.5">Cooking history</h2>
        {history.length === 0 ? (
          <p className="text-sm text-soft">Not cooked yet.</p>
        ) : (
          <div className="card p-4 text-sm">
            <p>
              Cooked {history.length} time{history.length === 1 ? '' : 's'} · last on {cookedDate(history[0].cookedOn)}
            </p>
            <ul className="mt-2 space-y-1 font-data text-xs text-soft">
              {history.map((h) => (
                <li key={`${h.weekStart}-${h.day}`}>{cookedDate(h.cookedOn)}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="card border-t-[3px] border-t-bottle p-5">
        <h2 className="mb-3 font-display text-[19px]">Edit recipe</h2>
        <form action={updateRecipeAction} className="grid gap-2.5 text-sm">
          <input type="hidden" name="id" value={recipe.id} />
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <input name="name" defaultValue={recipe.name} required className="field" />
            <input name="cuisine" defaultValue={recipe.cuisine} className="field" />
            <input name="servings" type="number" defaultValue={recipe.servings} className="field" />
          </div>
          <textarea name="ingredients" rows={Math.max(4, recipe.ingredients.length)} required className="field"
            defaultValue={formatIngredientLines(recipe.ingredients)} />
          <textarea name="method" rows={3} defaultValue={recipe.method} placeholder="Method (optional)" className="field" />
          <input name="tags" defaultValue={recipe.tags.join(', ')} placeholder="Tags, comma-separated" className="field" />
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <input name="kcal" type="number" defaultValue={Math.round(recipe.perServing.kcal)} placeholder="kcal/serving" className="field" />
            <input name="protein" type="number" defaultValue={Math.round(recipe.perServing.protein)} placeholder="protein g" className="field" />
            <input name="carbs" type="number" defaultValue={Math.round(recipe.perServing.carbs)} placeholder="carbs g" className="field" />
            <input name="fat" type="number" defaultValue={Math.round(recipe.perServing.fat)} placeholder="fat g" className="field" />
          </div>
          <fieldset>
            <legend className="eyebrow mb-1.5">Equipment used · optional</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {CAPABILITIES.map((cap) => (
                <label key={cap} className="flex cursor-pointer items-center gap-2">
                  <input type="checkbox" name="equipment" value={cap} defaultChecked={recipe.equipment.includes(cap)} className="tick" />
                  {cap}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" name="estimateWithAi" defaultChecked className="tick" />
            Re-estimate macros &amp; store sections with AI (overrides the numbers above)
          </label>
          <button className="btn btn-primary justify-self-start">Save changes</button>
        </form>
      </section>
    </main>
  );
}
```

- [ ] **Step 3: Typecheck and build**

Run: `npm run build && npx tsc --noEmit`
Expected: both succeed, `/recipes/[id]` appears in the build's route list as dynamic.

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/recipes.ts "src/app/(app)/recipes/[id]/page.tsx"
git commit -m "feat: recipe detail page — full view, cooking history, edit form"
```

---

### Task 7: Link the list page through; drop the inline details

**Files:**
- Modify: `src/app/(app)/recipes/page.tsx`

**Interfaces:**
- Consumes: the `/recipes/[id]` route from Task 6.
- Produces: nothing new — list page behaviour only.

- [ ] **Step 1: Make recipe names links and remove the favourites' `<details>` block**

In `src/app/(app)/recipes/page.tsx`, add `import Link from 'next/link';` at the top.

In the favourites card, replace:

```tsx
                <strong className="font-display text-[17px] leading-snug font-normal">{r.name}</strong>
```

with:

```tsx
                <Link href={`/recipes/${r.id}`} className="font-display text-[17px] leading-snug hover:text-bottle">
                  {r.name}
                </Link>
```

Delete the whole `<details className="mt-2">…</details>` block (ingredients & method) from the favourites card.

In the AI-suggested list, replace:

```tsx
                <span>{r.name}</span>
```

with:

```tsx
                <Link href={`/recipes/${r.id}`} className="hover:text-bottle">{r.name}</Link>
```

- [ ] **Step 2: Typecheck and build**

Run: `npm run build && npx tsc --noEmit`
Expected: both succeed.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/recipes/page.tsx"
git commit -m "feat: recipe list links through to the detail page"
```

---

### Task 8: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including the new `recipes.test.ts` (10) and extended `ingredients.test.ts` (4).

- [ ] **Step 2: Production build + typecheck**

Run: `npm run build && npx tsc --noEmit`
Expected: both succeed.

- [ ] **Step 3: Verify no schema drift**

Run: `git status --short src/lib/db/`
Expected: no output — the schema was never touched, so no `db:generate`/`db:push` is needed.
