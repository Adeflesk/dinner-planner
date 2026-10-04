# Recipe Fetching and Query Optimization — Design Spec

**Date:** 2026-10-04  
**Status:** Proposed / Ready for Implementation  
**Roadmap items:** 13 (Performance niceties: indexes & batching N+1 queries) and 16 (Retry backoff in `generateRecipe`) from `docs/roadmap.md`  
**Related Review:** [recipe_fetching_review.md](file:///Users/adriancorsini/.gemini/antigravity-ide/brain/589d5f5e-afff-49b7-b964-0b38099d6474/recipe_fetching_review.md)

---

## 1. Problem Statement

Recipe data access in **Dinner Planner** spans two critical paths:
1. **Relational Database Fetching:** Neon Serverless Postgres via Drizzle ORM HTTP driver (`drizzle-orm/neon-http`).
2. **AI Recipe Generation & Fetching:** Vercel AI SDK (`ai`) through Vercel AI Gateway targeting `google/gemini-2.5-flash-lite`.

A systematic audit revealed that the current architecture incurs high latency multipliers, unnecessary bandwidth overhead, and resilience risks under real-world usage.

### 1.1 The Neon HTTP Latency Multiplier
`src/lib/db/index.ts` connects using `drizzle(neon(process.env.DATABASE_URL!))`. Unlike persistent TCP socket pools, the Neon HTTP driver executes **every SQL query as an independent HTTPS POST request over the public internet** (`https://*.neon.tech/sql`), each paying TLS and WAN roundtrip costs (~25ms–80ms per query).

Under this transport model, executing queries in loops (even small ones) turns what would be sub-millisecond local queries into hundreds of milliseconds of user-facing latency.

### 1.2 N+1 Database Query Cascades
1. **`getWeek` (`src/lib/services/planning.ts:229-234`):**
   Fetches planned dinner rows, then fires `Promise.all(rows.map(async (row) => db.select().from(recipes).where(eq(recipes.id, row.recipeId))))`. For a 7-day week, this generates **7 separate HTTPS queries** in parallel on every page load, bringing the home page load to ~12 total roundtrips.
2. **`swapDay` (`src/lib/services/planning.ts:178-181`):**
   Loops sequentially through all planned days: `for (const d of week) await db.select().from(recipes).where(eq(recipes.id, d.recipeId))`. This issues **7 sequential HTTPS calls**, adding 350ms–500ms of avoidable delay to day swaps.
3. **`weekScaledRecipes` (`src/lib/services/shopping.ts:14-18`):**
   Loops sequentially over planned dinners: `for (const row of rows) await db.select().from(recipes)...`. Called during both `staplesCheck` and `buildList`, incurring 7 sequential roundtrips.
4. **`planWeek` (`src/lib/services/planning.ts:97-100`):**
   Loops sequentially over pinned rows: `for (const row of pinnedRows) await db.select().from(recipes)...`.

### 1.3 Full-Table Over-Fetching and Payload Bloat
1. **`pickerOptions` (`src/lib/services/planning.ts:266`):**
   Executes `SELECT * FROM recipes ORDER BY created_at DESC`. It pulls every recipe row including massive JSON columns (`ingredients`, `method`, `tags`, `equipment`), only to extract 5 scalar fields (`id`, `name`, `cuisine`, `kcal`, `favourite`). Search filtering (`q`) happens in Node.js memory after transferring the entire table.
2. **Recipes Index (`src/app/(app)/recipes/page.tsx:11`):**
   Loads all recipes across the wire without column selection or pagination.
3. **AI Orphan Pruning (`src/lib/services/planning.ts:59-65`):**
   Selects all AI recipe IDs and **all `planned_dinners.recipe_id` rows ever stored in database history** into Node.js memory, performs a JavaScript `Set` difference, and deletes orphans. As historical plans accumulate, this scans and transfers hundreds of unused rows into serverless memory.

### 1.4 Missing Schema Indexes
In `src/lib/db/schema.ts`:
- **`recipes.source` is unindexed:** Queries filtering `WHERE source = 'family'` (`loadContext`) or `WHERE source = 'ai'` (`pruneOrphanAiRecipes`, `planWeek`) perform full table scans.
- **Missing composite index `(source, created_at)`:** `planWeek` queries `WHERE source = 'ai' ORDER BY created_at DESC LIMIT 20`, forcing an in-memory sort after a table scan.
- **Foreign key `planned_dinners.recipe_id` is unindexed:** Foreign keys are not indexed by default in Postgres. Queries in `recipeHistory` and `deleteRecipe` filtering by `recipeId` perform full table scans on `planned_dinners`.

### 1.5 AI Generation Burst Concurrency & Rate Limits
In `src/lib/planner/draft.ts:144-151`:
- Phase 2 fires up to 4–6 simultaneous AI calls in `Promise.all`.
- Bursting 6 complex JSON generation prompts simultaneously can trigger HTTP 429 (`RESOURCE_EXHAUSTED`) on upstream free tiers.
- In `src/lib/ai/recipes.ts:89-132`, retries happen **immediately** (`attempt 0` -> `attempt 1`) without backoff or jitter.
- All concurrent requests share the exact same `avoidNames` list, leading to duplicate dish collisions and wasted generation rounds.
- With `TIMEOUT_MS = 20_000`, retries can push Server Action execution past Vercel's default 15s Hobby timeout, resulting in unhandled 504 gateway timeouts.

---

## 2. Decision & Architecture

We propose six targeted improvements across two phases:

### Phase 1: Zero-Migration Database & Query Optimization (Immediate)
1. **Collapse `getWeek` to a single SQL `INNER JOIN`:** Join `plannedDinners` and `recipes` directly in SQL, reducing 8 queries to 1.
2. **Batch `swapDay` and `planWeek` with `inArray`:** Replace sequential recipe query loops with a single batch `where(inArray(recipes.id, recipeIds))`.
3. **Join and Project `weekScaledRecipes`:** Replace sequential loops in `shopping.ts` with an `INNER JOIN` projecting only `{ householdServings, servings, ingredients }`.
4. **Project Columns in `pickerOptions`:** Select only the 5 required fields and push search filtering into SQL `ilike`.
5. **SQL Subquery for AI Orphan Pruning:** Replace JavaScript memory diffing with a single SQL `DELETE ... WHERE source = 'ai' AND id NOT IN (SELECT DISTINCT recipe_id FROM planned_dinners)`.
6. **Configure `maxDuration = 60` on Actions:** Ensure Vercel serverless execution does not kill planning workflows at 15s.

### Phase 2: Schema Hardening & AI Resilience
1. **Add Schema Indexes:** Add indexes on `recipes(source, createdAt)` and `planned_dinners(recipeId)`.
2. **Exponential Backoff in `generateRecipe`:** Add randomized backoff (500ms–1500ms) between retry attempts.

---

## 3. Detailed Specifications

### 3.1 `getWeek` Join Refactoring (`src/lib/services/planning.ts`)

#### Current:
```typescript
const rows = await db.select().from(plannedDinners).where(eq(plannedDinners.weekPlanId, plan.id));
const dinners = await Promise.all(
  rows.sort((a, b) => a.day - b.day).map(async (row) => {
    const [recipe] = await db.select().from(recipes).where(eq(recipes.id, row.recipeId));
    return { ...row, recipe };
  }),
);
```

#### Proposed:
```typescript
const rows = await db
  .select({
    dinner: plannedDinners,
    recipe: recipes,
  })
  .from(plannedDinners)
  .innerJoin(recipes, eq(plannedDinners.recipeId, recipes.id))
  .where(eq(plannedDinners.weekPlanId, plan.id))
  .orderBy(plannedDinners.day);

const dinners = rows.map((r) => ({
  ...r.dinner,
  recipe: r.recipe,
}));
```
**Savings:** 7 network roundtrips eliminated on every home page view.

---

### 3.2 `swapDay` Batching (`src/lib/services/planning.ts`)

#### Current:
```typescript
const current = week.find((d) => d.day === day);
const currentRecipe = current
  ? (await db.select().from(recipes).where(eq(recipes.id, current.recipeId)))[0]
  : null;
const usedNames = new Set<string>();
for (const d of week) {
  const [r] = await db.select().from(recipes).where(eq(recipes.id, d.recipeId));
  if (r) usedNames.add(r.name.toLowerCase());
}
```

#### Proposed:
```typescript
const current = week.find((d) => d.day === day);
const recipeIds = week.map((d) => d.recipeId);
const weekRecipes = recipeIds.length
  ? await db
      .select({ id: recipes.id, name: recipes.name, cuisine: recipes.cuisine })
      .from(recipes)
      .where(inArray(recipes.id, recipeIds))
  : [];

const recipeMap = new Map(weekRecipes.map((r) => [r.id, r]));
const currentRecipe = current ? recipeMap.get(current.recipeId) ?? null : null;
const usedNames = new Set(weekRecipes.map((r) => r.name.toLowerCase()));
```
**Savings:** 8 sequential network roundtrips reduced to 1 batched query.

---

### 3.3 `weekScaledRecipes` Join (`src/lib/services/shopping.ts`)

#### Current:
```typescript
async function weekScaledRecipes(db: Db, weekStart: string): Promise<ScaledRecipe[]> {
  const [plan] = await db.select().from(weekPlans).where(eq(weekPlans.weekStart, weekStart));
  if (!plan) return [];
  const rows = await db.select().from(plannedDinners).where(eq(plannedDinners.weekPlanId, plan.id));
  const out: ScaledRecipe[] = [];
  for (const row of rows) {
    const [recipe] = await db.select().from(recipes).where(eq(recipes.id, row.recipeId));
    if (recipe) out.push({ ingredients: recipe.ingredients, scale: row.householdServings / recipe.servings });
  }
  return out;
}
```

#### Proposed:
```typescript
async function weekScaledRecipes(db: Db, weekStart: string): Promise<ScaledRecipe[]> {
  const [plan] = await db.select().from(weekPlans).where(eq(weekPlans.weekStart, weekStart));
  if (!plan) return [];

  const rows = await db
    .select({
      householdServings: plannedDinners.householdServings,
      servings: recipes.servings,
      ingredients: recipes.ingredients,
    })
    .from(plannedDinners)
    .innerJoin(recipes, eq(plannedDinners.recipeId, recipes.id))
    .where(eq(plannedDinners.weekPlanId, plan.id));

  return rows.map((r) => ({
    ingredients: r.ingredients,
    scale: r.householdServings / r.servings,
  }));
}
```
**Savings:** Eliminates 7 sequential roundtrips in `staplesCheck` and `buildList`.

---

### 3.4 `pickerOptions` Field Projection & SQL Search (`src/lib/services/planning.ts`)

#### Current:
```typescript
const all = await db.select().from(recipes).orderBy(desc(recipes.createdAt));
// transfers all columns (json ingredients, full method, etc.)
const needle = (query ?? '').trim().toLowerCase();
return all
  .filter((r) => needle === '' || r.name.toLowerCase().includes(needle))
  .map(...)
```

#### Proposed:
```typescript
const needle = (query ?? '').trim();
const baseQuery = db
  .select({
    id: recipes.id,
    name: recipes.name,
    cuisine: recipes.cuisine,
    perServing: recipes.perServing,
    source: recipes.source,
    createdAt: recipes.createdAt,
  })
  .from(recipes);

const all = needle
  ? await baseQuery.where(ilike(recipes.name, `%${needle}%`)).orderBy(desc(recipes.createdAt))
  : await baseQuery.orderBy(desc(recipes.createdAt));

const [plan] = await db.select().from(weekPlans).where(eq(weekPlans.weekStart, weekStart));
const dayByRecipe = new Map<string, number>();
if (plan) {
  const rows = await db
    .select({ recipeId: plannedDinners.recipeId, day: plannedDinners.day })
    .from(plannedDinners)
    .where(eq(plannedDinners.weekPlanId, plan.id));
  for (const row of rows) dayByRecipe.set(row.recipeId, row.day);
}

return all
  .map((r) => ({
    id: r.id,
    name: r.name,
    cuisine: r.cuisine,
    kcal: Math.round(r.perServing.kcal),
    favourite: r.source === 'family',
    plannedDay: dayByRecipe.get(r.id) ?? null,
  }))
  .sort((a, b) => Number(b.favourite) - Number(a.favourite));
```
**Savings:** ~80% reduction in bytes transferred per picker query; search executed inside Postgres engine.

---

### 3.5 Server-Side SQL Orphan Pruning (`src/lib/services/planning.ts`)

#### Current:
```typescript
async function pruneOrphanAiRecipes(db: Db) {
  const aiRecipes = await db.select({ id: recipes.id }).from(recipes).where(eq(recipes.source, 'ai'));
  const referenced = new Set(
    (await db.select({ recipeId: plannedDinners.recipeId }).from(plannedDinners)).map((r) => r.recipeId),
  );
  const orphans = aiRecipes.filter((r) => !referenced.has(r.id)).map((r) => r.id);
  if (orphans.length) await db.delete(recipes).where(inArray(recipes.id, orphans));
}
```

#### Proposed:
```typescript
async function pruneOrphanAiRecipes(db: Db) {
  const inUse = db.selectDistinct({ id: plannedDinners.recipeId }).from(plannedDinners);
  await db.delete(recipes).where(
    and(
      eq(recipes.source, 'ai'),
      notInArray(recipes.id, inUse),
    ),
  );
}
```
**Savings:** Avoids fetching all past dinner IDs into Node memory; single atomic SQL statement.

---

### 3.6 Schema Index Additions (`src/lib/db/schema.ts`)

Add indexes on high-traffic filter and foreign key columns:
```typescript
export const recipes = pgTable('recipes', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  cuisine: text('cuisine').notNull().default('any'),
  method: text('method').notNull().default(''),
  servings: integer('servings').notNull().default(4),
  perServing: jsonb('per_serving').$type<MacroSet>().notNull(),
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  equipment: jsonb('equipment').$type<string[]>().notNull().default([]),
  source: text('source', { enum: ['family', 'ai'] }).notNull().default('family'),
  ingredients: jsonb('ingredients').$type<Ingredient[]>().notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  sourceCreatedAtIdx: index('recipes_source_created_at_idx').on(t.source, t.createdAt),
}));

export const plannedDinners = pgTable('planned_dinners', {
  id: uuid('id').primaryKey().defaultRandom(),
  weekPlanId: uuid('week_plan_id').notNull().references(() => weekPlans.id, { onDelete: 'cascade' }),
  day: integer('day').notNull(),
  recipeId: uuid('recipe_id').notNull().references(() => recipes.id),
  householdServings: real('household_servings').notNull(),
  portions: jsonb('portions').$type<Portion[]>().notNull(),
  pinned: boolean('pinned').notNull().default(false),
}, (t) => ({
  dayPerWeekIdx: uniqueIndex('planned_dinners_week_plan_id_day_idx').on(t.weekPlanId, t.day),
  recipeIdIdx: index('planned_dinners_recipe_id_idx').on(t.recipeId),
}));
```

---

### 3.7 AI Generation Backoff & Serverless Action Timeout

1. **Jittered Backoff in `generateRecipe` (`src/lib/ai/recipes.ts`):**
   ```typescript
   export async function generateRecipe(
     req: RecipeRequest,
     gen: Generator = aiGenerator,
     sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
   ): Promise<AiRecipe | null> {
     for (let attempt = 0; attempt < 2; attempt++) {
       if (attempt > 0) {
         // 500ms base + up to 500ms random jitter to avoid lockstep retry storms
         await sleep(500 + Math.floor(Math.random() * 500));
       }
       try {
         // ...
   ```
2. **Serverless Function Duration Guard (`src/app/actions/plan.ts`):**
   ```typescript
   'use server';

   export const maxDuration = 60; // Allow up to 60s for multi-slot AI planning runs
   ```

---

## 4. Migration & Rollout Strategy

1. **Phase 1 Implementation (Zero Schema Migration):**
   - Apply Drizzle query optimizations (`getWeek` join, `swapDay` batching, `weekScaledRecipes` join, `pickerOptions` projection, and `pruneOrphanAiRecipes` subquery).
   - Run existing test suite (`npm test`). All 237 tests run on PGlite in-memory database and will immediately validate query semantics.
   - Deploy to production. Verify page responsiveness in Vercel Analytics.

2. **Phase 2 Implementation (Database Schema Migration):**
   - Update `src/lib/db/schema.ts` to include `recipes_source_created_at_idx` and `planned_dinners_recipe_id_idx`.
   - Run `npm run db:generate` to produce the SQL migration file.
   - Run `npm run db:push` to apply the indexes to Neon Postgres.
   - Add backoff to `src/lib/ai/recipes.ts` and update unit tests with mock timers.

---

## 5. Testing & Verification

1. **Query Correctness:**
   - Existing integration flow tests (`tests/integration/flows.test.ts`) assert exact week planning, day swapping, shopping list generation, and staple checks. These must remain 100% green.
2. **Join Equivalence:**
   - Verify that `getWeek` returns identical object shapes (`{ ...dinner, recipe }`) including all macro calculations and portion assignments.
3. **Empty Week / Partial Week Scenarios:**
   - Ensure `getWeek` correctly returns an empty array of dinners when no dinners are planned for the week start.
4. **Search Filtering:**
   - Verify that `pickerOptions(db, weekStart, 'chicken')` matches case-insensitively via SQL `ilike`.
