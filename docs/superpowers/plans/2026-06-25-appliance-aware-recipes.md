# Appliance-Aware Recipes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the household record its kitchen equipment so AI dinners are written for that gear, suggestions softly favour standout appliances, and no recipe is ever planned that needs equipment the kitchen lacks.

**Architecture:** A new pure module `src/lib/macro/equipment.ts` holds the capability vocabulary, the standout/baseline split, the quality/speed benefit map, the equipment re-screen predicate, and the favourite-biasing score — deterministic and dependency-free, exactly like the existing `validate.ts`. Two jsonb columns (`recipes.equipment`, `settings.equipment`) carry the data. The AI layer adds equipment to its Zod schemas, prompt, and validation loop; the planner threads equipment through favourite ranking and per-day benefit; the service wires household equipment in; three thin UI changes expose it.

**Tech Stack:** Next.js App Router (server components + server actions), Drizzle ORM on Neon/PGlite, AI SDK v6 `generateObject` with Zod, Vitest.

## Global Constraints

- **Day indexing: 0 = Monday … 6 = Sunday.** Weeknights = days 0–3 (Mon–Thu), weekends = days 4–6 (Fri–Sun).
- **Capability vocabulary (closed set, exact strings):** `steam`, `combi-steam`, `microwave`, `convection`, `grill/broil`, `induction-hob`, `air-fry`, `sous-vide`.
- **Standout set (drives biasing + badges):** `steam`, `combi-steam`, `sous-vide`, `air-fry`. Everything else is baseline — never biased, never badged.
- **Benefit map:** `steam`/`combi-steam`/`sous-vide` → `quality`; `air-fry` → `speed`.
- **Layering:** `src/lib/macro/` is pure, deterministic, dependency-free, no I/O. AI never does arithmetic. Services take a `Db` param. Actions are thin: parse `FormData`, call a service, `revalidatePath`.
- **AI failure must never block:** equipment biasing degrades silently to favourites-only; the favourites-only fallback ignores equipment.
- **Migrations must be generated before integration tests pass** (`npm run db:generate`); PGlite applies them in `createTestDb`.
- Existing test fixtures build `AiRecipe` / `RecipeData` / `MacroEstimate` literals — when those types gain `equipment`, every literal must include it or the build breaks.

## File Structure

- **Create** `src/lib/macro/equipment.ts` — vocabulary, standout set, benefit map, `dayBenefit`, `standoutTags`, `lacksEquipment`, `scoreFavourite`. One responsibility: pure equipment logic.
- **Create** `src/lib/macro/equipment.test.ts` — unit tests for the above.
- **Create** `src/lib/db/schema.test.ts` — round-trip tests proving the new columns and defaults.
- **Create** `src/lib/services/planning.test.ts` — integration test: equipment re-screen + biasing through `planWeek`.
- **Modify** `src/lib/db/schema.ts` — add `equipment` to `recipes` and `settings`.
- **Modify** `src/lib/macro/types.ts` — add `equipment` to `RecipeData`.
- **Modify** `src/lib/ai/schema.ts` — add `equipment` to `aiRecipeSchema` and `macroEstimateSchema`.
- **Modify** `src/lib/ai/recipes.ts` — `RecipeRequest` fields, prompt, equipment re-screen, estimator prompt.
- **Modify** `src/lib/planner/draft.ts` — biased `pickFavourite`, per-day benefit, prev-night method-spread.
- **Modify** `src/lib/services/planning.ts` — pass household equipment + benefit into generation and draft.
- **Modify** `src/app/(app)/family/page.tsx` + `src/app/actions/family.ts` — equipment picker.
- **Modify** `src/app/(app)/recipes/page.tsx` + `src/app/actions/recipes.ts` — equipment on add form, display, estimate.
- **Modify** `src/app/(app)/page.tsx` — standout badge on day cards.
- Generated migration file under `drizzle/` (auto-named).

---

### Task 1: Pure equipment module

**Files:**
- Create: `src/lib/macro/equipment.ts`
- Test: `src/lib/macro/equipment.test.ts`

**Interfaces:**
- Consumes: nothing (pure, dependency-free).
- Produces:
  - `CAPABILITIES: readonly Capability[]` and `type Capability`
  - `STANDOUT: readonly Capability[]`
  - `type Benefit = 'quality' | 'speed'` and `BENEFIT: Record<string, Benefit>`
  - `dayBenefit(day: number): Benefit`
  - `standoutTags(equipment: string[]): string[]`
  - `lacksEquipment(recipeEquipment: string[], household: string[]): string[]`
  - `scoreFavourite(recipe: { equipment: string[] }, opts: { day: number; household: string[]; prevStandout: string[] }): number`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/macro/equipment.test.ts
import { describe, expect, it } from 'vitest';
import {
  CAPABILITIES, STANDOUT, dayBenefit, standoutTags, lacksEquipment, scoreFavourite,
} from './equipment';

describe('vocabulary', () => {
  it('has the 8 closed-set capabilities', () => {
    expect([...CAPABILITIES]).toEqual([
      'steam', 'combi-steam', 'microwave', 'convection',
      'grill/broil', 'induction-hob', 'air-fry', 'sous-vide',
    ]);
  });
  it('marks only premium gear as standout', () => {
    expect([...STANDOUT]).toEqual(['steam', 'combi-steam', 'sous-vide', 'air-fry']);
  });
});

describe('dayBenefit', () => {
  it('leans speed Mon–Thu (days 0–3)', () => {
    expect([0, 1, 2, 3].map(dayBenefit)).toEqual(['speed', 'speed', 'speed', 'speed']);
  });
  it('leans quality Fri–Sun (days 4–6)', () => {
    expect([4, 5, 6].map(dayBenefit)).toEqual(['quality', 'quality', 'quality']);
  });
});

describe('standoutTags', () => {
  it('returns only standout tags, case-insensitive and deduped', () => {
    expect(standoutTags(['Steam', 'convection', 'steam', 'air-fry']).sort())
      .toEqual(['air-fry', 'steam']);
  });
  it('returns empty for baseline-only equipment', () => {
    expect(standoutTags(['convection', 'induction-hob'])).toEqual([]);
  });
});

describe('lacksEquipment', () => {
  it('lists capabilities the household does not have (case-insensitive)', () => {
    expect(lacksEquipment(['Sous-Vide', 'steam'], ['steam', 'convection'])).toEqual(['sous-vide']);
  });
  it('returns empty when the recipe needs nothing extra', () => {
    expect(lacksEquipment([], ['steam'])).toEqual([]);
    expect(lacksEquipment(['steam'], ['steam', 'air-fry'])).toEqual([]);
  });
});

describe('scoreFavourite', () => {
  const have = ['steam', 'air-fry']; // household with one quality + one speed appliance

  it('scores 0 for a recipe using no standout gear the household has', () => {
    expect(scoreFavourite({ equipment: ['convection'] }, { day: 0, household: have, prevStandout: [] })).toBe(0);
  });
  it('gives +2 for using standout gear, +1 more when benefit fits the day', () => {
    // air-fry = speed; day 0 is a weeknight (speed) → 2 + 1
    expect(scoreFavourite({ equipment: ['air-fry'] }, { day: 0, household: have, prevStandout: [] })).toBe(3);
    // steam = quality on a weeknight → 2 + 0
    expect(scoreFavourite({ equipment: ['steam'] }, { day: 0, household: have, prevStandout: [] })).toBe(2);
    // steam = quality on a weekend (day 5) → 2 + 1
    expect(scoreFavourite({ equipment: ['steam'] }, { day: 5, household: have, prevStandout: [] })).toBe(3);
  });
  it('penalises repeating last night’s standout method', () => {
    // steam again right after a steam night: 2 + 0 (weeknight) - 2 = 0
    expect(scoreFavourite({ equipment: ['steam'] }, { day: 1, household: have, prevStandout: ['steam'] })).toBe(0);
  });
  it('ignores standout gear the household does not actually have', () => {
    expect(scoreFavourite({ equipment: ['sous-vide'] }, { day: 0, household: have, prevStandout: [] })).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/macro/equipment.test.ts`
Expected: FAIL — cannot find module `./equipment`.

- [ ] **Step 3: Write the module**

```ts
// src/lib/macro/equipment.ts
// Cooking-equipment capability vocabulary and the pure helpers that screen and
// rank recipes against a household's kitchen. Deterministic and dependency-free,
// like validate.ts — no I/O, no macro arithmetic.

export const CAPABILITIES = [
  'steam', 'combi-steam', 'microwave', 'convection',
  'grill/broil', 'induction-hob', 'air-fry', 'sous-vide',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

// Only these "standout" capabilities drive biasing and badging; the rest
// (convection, grill/broil, induction-hob, microwave) are gear every kitchen has.
export const STANDOUT: readonly Capability[] = ['steam', 'combi-steam', 'sous-vide', 'air-fry'];

export type Benefit = 'quality' | 'speed';
// The two premium appliances have opposite superpowers: the steam oven's edge is
// quality (moisture, gentle cooking), the air-fry/combi-microwave's edge is speed.
export const BENEFIT: Record<string, Benefit> = {
  steam: 'quality',
  'combi-steam': 'quality',
  'sous-vide': 'quality',
  'air-fry': 'speed',
};

const norm = (s: string) => s.trim().toLowerCase();

/** Weeknights (Mon–Thu, days 0–3) lean speed; weekends (Fri–Sun, 4–6) lean quality. */
export function dayBenefit(day: number): Benefit {
  return day <= 3 ? 'speed' : 'quality';
}

/** The standout capabilities a recipe uses (case-insensitive, deduped). */
export function standoutTags(equipment: string[]): string[] {
  const standout = new Set(STANDOUT.map(norm));
  return [...new Set(equipment.map(norm))].filter((e) => standout.has(e));
}

/**
 * Capabilities a recipe needs that the household does not have. Empty array means
 * the recipe is cookable here. Mirrors validate.ts#violatesAllergies.
 */
export function lacksEquipment(recipeEquipment: string[], household: string[]): string[] {
  const have = new Set(household.map(norm));
  return [...new Set(recipeEquipment.map(norm))].filter((e) => !have.has(e));
}

/**
 * Soft bias score for choosing a favourite on a given day. Higher is better.
 *   +2  uses a standout capability the household actually has
 *   +1  that capability's benefit matches the day (speed weeknight / quality weekend)
 *   -2  repeats a standout capability used the night before (method-spread penalty)
 * A recipe with no usable standout gear scores 0 — never penalised, never preferred.
 */
export function scoreFavourite(
  recipe: { equipment: string[] },
  opts: { day: number; household: string[]; prevStandout: string[] },
): number {
  const have = new Set(opts.household.map(norm));
  const prev = new Set(opts.prevStandout.map(norm));
  const tags = standoutTags(recipe.equipment).filter((t) => have.has(t));
  if (tags.length === 0) return 0;
  let score = 2;
  if (tags.some((t) => BENEFIT[t] === dayBenefit(opts.day))) score += 1;
  if (tags.some((t) => prev.has(t))) score -= 2;
  return score;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/macro/equipment.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/macro/equipment.ts src/lib/macro/equipment.test.ts
git commit -m "feat: pure equipment vocabulary, re-screen and biasing helpers"
```

---

### Task 2: Data model + types + migration

**Files:**
- Modify: `src/lib/db/schema.ts:21-32` (recipes), `src/lib/db/schema.ts:64-69` (settings)
- Modify: `src/lib/macro/types.ts:28-36` (RecipeData)
- Modify: `src/lib/ai/schema.ts:14-29` (both schemas)
- Modify: `src/lib/planner/draft.test.ts:5-15` (fixtures)
- Modify: `src/lib/ai/recipes.test.ts:5-11,41-44` (fixtures)
- Create: `src/lib/db/schema.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `recipes.equipment` and `settings.equipment` columns (jsonb `string[]`, default `[]`); `RecipeData.equipment: string[]`; `AiRecipe.equipment: string[]`; `MacroEstimate.equipment: string[]`.

- [ ] **Step 1: Add the columns to the schema**

In `src/lib/db/schema.ts`, add `equipment` to `recipes` (after the `tags` line):

```ts
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  equipment: jsonb('equipment').$type<string[]>().notNull().default([]),
```

and to `settings` (after `cuisines`):

```ts
  cuisines: jsonb('cuisines').$type<string[]>().notNull().default([]),
  equipment: jsonb('equipment').$type<string[]>().notNull().default([]),
  vegetarianNights: integer('vegetarian_nights').notNull().default(0),
```

- [ ] **Step 2: Add `equipment` to `RecipeData`**

In `src/lib/macro/types.ts`, in the `RecipeData` type add after `tags`:

```ts
  tags: string[];
  equipment: string[];
  ingredients: Ingredient[];
```

- [ ] **Step 3: Add `equipment` to the Zod schemas**

In `src/lib/ai/schema.ts`, add to `aiRecipeSchema` (after `tags`) and to `macroEstimateSchema`. Use `.default([])` so a model that omits the field still validates:

```ts
export const aiRecipeSchema = z.object({
  name: z.string(),
  cuisine: z.string(),
  method: z.string(),
  servings: z.number().int().positive(),
  perServing: macroSetSchema,
  tags: z.array(z.string()),
  equipment: z.array(z.string()).default([]),
  ingredients: z.array(ingredientSchema).min(1),
});
export type AiRecipe = z.infer<typeof aiRecipeSchema>;

export const macroEstimateSchema = z.object({
  perServing: macroSetSchema,
  equipment: z.array(z.string()).default([]),
  ingredients: z.array(ingredientSchema).min(1),
});
export type MacroEstimate = z.infer<typeof macroEstimateSchema>;
```

- [ ] **Step 4: Update existing fixtures so the build stays green**

In `src/lib/planner/draft.test.ts`, add `equipment: []` to both factories:

```ts
const fav = (name: string, cuisine: string, tags: string[] = []): FavouriteRecipe => ({
  id: `fav-${name}`, name, cuisine, method: '', servings: 4,
  perServing: { kcal: 600, protein: 40, carbs: 55, fat: 20 }, tags, equipment: [],
  ingredients: [{ name: 'x', quantity: 1, unit: 'pcs', section: 'other' }],
});

const aiRecipe = (name: string, cuisine: string, tags: string[] = []): AiRecipe => ({
  name, cuisine, method: 'cook', servings: 4,
  perServing: { kcal: 600, protein: 40, carbs: 55, fat: 20 }, tags, equipment: [],
  ingredients: [{ name: 'y', quantity: 1, unit: 'pcs', section: 'other' }],
});
```

In `src/lib/ai/recipes.test.ts`, add `equipment: []` to `goodRecipe` and `goodEstimate`:

```ts
const goodRecipe: AiRecipe = {
  name: 'Chicken stir-fry', cuisine: 'chinese', method: 'Stir fry everything.',
  servings: 4,
  perServing: { kcal: 600, protein: 40, carbs: 55, fat: 20 },
  tags: [], equipment: [],
  ingredients: [{ name: 'chicken breast', quantity: 500, unit: 'g', section: 'meat_fish' }],
};
```

```ts
const goodEstimate: MacroEstimate = {
  perServing: { kcal: 600, protein: 40, carbs: 55, fat: 20 },
  equipment: [],
  ingredients: [{ name: 'chicken breast', quantity: 500, unit: 'g', section: 'meat_fish' }],
};
```

- [ ] **Step 5: Write the failing round-trip test**

```ts
// src/lib/db/schema.test.ts
import { describe, expect, it } from 'vitest';
import { createTestDb } from '@/lib/test/db';
import { recipes, settings } from '@/lib/db/schema';

describe('equipment columns', () => {
  it('defaults recipes.equipment to an empty array', async () => {
    const db = await createTestDb();
    const [row] = await db.insert(recipes).values({
      name: 'Plain bake', perServing: { kcal: 500, protein: 30, carbs: 50, fat: 18 },
      ingredients: [{ name: 'potato', quantity: 4, unit: 'pcs', section: 'produce' }],
    }).returning();
    expect(row.equipment).toEqual([]);
  });

  it('round-trips recipes.equipment through jsonb', async () => {
    const db = await createTestDb();
    const [row] = await db.insert(recipes).values({
      name: 'Steamed fish', perServing: { kcal: 400, protein: 35, carbs: 20, fat: 18 },
      equipment: ['steam', 'combi-steam'],
      ingredients: [{ name: 'salmon', quantity: 500, unit: 'g', section: 'meat_fish' }],
    }).returning();
    expect(row.equipment).toEqual(['steam', 'combi-steam']);
  });

  it('defaults settings.equipment to an empty array', async () => {
    const db = await createTestDb();
    await db.insert(settings).values({ id: 1 });
    const [row] = await db.select().from(settings);
    expect(row.equipment).toEqual([]);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npx vitest run src/lib/db/schema.test.ts`
Expected: FAIL — the `equipment` column does not exist yet (migration not generated).

- [ ] **Step 7: Generate the migration**

Run: `npm run db:generate`
Expected: a new file `drizzle/0002_*.sql` is created adding both `equipment` columns. PGlite's `createTestDb` applies it automatically.

- [ ] **Step 8: Run the test and full suite to verify green**

Run: `npx vitest run src/lib/db/schema.test.ts && npm test && npx tsc --noEmit`
Expected: PASS — new columns round-trip, all existing tests and types still compile.

- [ ] **Step 9: Commit**

```bash
git add src/lib/db/schema.ts src/lib/macro/types.ts src/lib/ai/schema.ts \
        src/lib/planner/draft.test.ts src/lib/ai/recipes.test.ts \
        src/lib/db/schema.test.ts drizzle/
git commit -m "feat: add equipment column to recipes and settings"
```

---

### Task 3: AI generation — equipment prompt + re-screen

**Files:**
- Modify: `src/lib/ai/recipes.ts`
- Modify: `src/lib/ai/recipes.test.ts`

**Interfaces:**
- Consumes: `lacksEquipment` from `@/lib/macro/equipment`; `Benefit` type.
- Produces: `RecipeRequest` gains `equipment: string[]` and `preferBenefit: Benefit`. `generateRecipe` rejects recipes whose `equipment` contains a capability the household lacks. `estimateRecipe` returns `equipment`.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/ai/recipes.test.ts`. First extend the shared `req` to carry the new fields, then add re-screen cases:

```ts
const req: RecipeRequest = {
  cuisine: 'chinese', targetPerServing: { kcal: 600, protein: 40, carbs: 55, fat: 20 },
  allergies: ['peanut'], dislikes: [], dietTags: [], avoidNames: [],
  equipment: ['steam', 'air-fry'], preferBenefit: 'speed',
};
```

```ts
describe('generateRecipe equipment re-screen', () => {
  it('rejects a recipe needing gear the household lacks, retries once', async () => {
    const needsSousVide = { ...goodRecipe, equipment: ['sous-vide'] };
    let calls = 0;
    const gen = async () => (++calls === 1 ? needsSousVide : goodRecipe);
    expect(await generateRecipe(req, gen)).toEqual(goodRecipe);
    expect(calls).toBe(2);
  });
  it('accepts a recipe using only available gear', async () => {
    const steamy = { ...goodRecipe, equipment: ['steam'] };
    expect(await generateRecipe(req, async () => steamy)).toEqual(steamy);
  });
  it('returns null when every attempt needs unavailable gear', async () => {
    const needsSousVide = { ...goodRecipe, equipment: ['sous-vide'] };
    expect(await generateRecipe(req, async () => needsSousVide)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/ai/recipes.test.ts`
Expected: FAIL — `RecipeRequest` has no `equipment`/`preferBenefit`; re-screen not implemented.

- [ ] **Step 3: Implement the request fields, prompt, and re-screen**

In `src/lib/ai/recipes.ts`, update the imports and `RecipeRequest`:

```ts
import { generateObject, gateway } from 'ai';
import type { MacroSet } from '@/lib/macro/types';
import { energyConsistent, violatesAllergies } from '@/lib/macro/validate';
import { lacksEquipment, type Benefit } from '@/lib/macro/equipment';
import { aiRecipeSchema, macroEstimateSchema, type AiRecipe, type MacroEstimate } from './schema';
```

```ts
export type RecipeRequest = {
  cuisine: string;
  targetPerServing: MacroSet;
  allergies: string[];
  dislikes: string[];
  dietTags: string[];      // e.g. ['vegetarian']
  avoidNames: string[];    // recent recipe names, for variety
  equipment: string[];     // household capabilities the recipe may use
  preferBenefit: Benefit;  // 'speed' on weeknights, 'quality' on weekends
};
```

Add an equipment guidance constant next to `UNIT_GUIDANCE`:

```ts
// Make the method actually exploit the gear rather than name-drop it. Steam-oven
// moisture control IS the feature; pure steam caps at 100°C; the oven is one cavity;
// "grill" is the oven's overhead element, not a barbecue.
const EQUIPMENT_GUIDANCE =
  'Where it improves the dish, write method steps that use these appliances. For ' +
  'steam or combi-steam give Miele-style program steps including the moisture/humidity ' +
  '%, e.g. "Combi Steam, 160°C, 60% moisture". Pure steam never exceeds 100°C; only ' +
  'combi modes go higher. The oven has a single cavity — do not run two oven programs ' +
  'at once; sequence steps or use the hob for sides. "grill" means the oven\'s overhead ' +
  'grill element, not an outdoor barbecue.';
```

Replace `buildPrompt` with the equipment-aware version:

```ts
function buildPrompt(req: RecipeRequest): string {
  const t = req.targetPerServing;
  return [
    `Create one family dinner recipe (4 base servings) in ${req.cuisine} cuisine.`,
    `Per-serving macro targets: ~${Math.round(t.kcal)} kcal, ${Math.round(t.protein)}g protein, ${Math.round(t.carbs)}g carbs, ${Math.round(t.fat)}g fat.`,
    `kcal must equal 4*protein + 4*carbs + 9*fat within 10%.`,
    req.allergies.length ? `NEVER include these allergens: ${req.allergies.join(', ')}.` : '',
    req.dislikes.length ? `Do not use: ${req.dislikes.join(', ')}.` : '',
    req.dietTags.length ? `The recipe must be: ${req.dietTags.join(', ')}.` : '',
    req.avoidNames.length ? `Do not suggest any of these recent dinners: ${req.avoidNames.join(', ')}.` : '',
    req.preferBenefit === 'speed'
      ? `Favour a quick, hands-off, weeknight-friendly method.`
      : `A more involved, quality-focused method is welcome.`,
    req.equipment.length
      ? `The kitchen has these capabilities: ${req.equipment.join(', ')}. ${EQUIPMENT_GUIDANCE}`
      : '',
    req.equipment.length
      ? `In the "equipment" field, list ONLY capabilities you actually used, chosen from: ${req.equipment.join(', ')}. If the recipe needs no special equipment, return an empty array.`
      : `Return an empty "equipment" array.`,
    `Assign each ingredient a realistic supermarket section.`,
    UNIT_GUIDANCE,
  ].filter(Boolean).join('\n');
}
```

Add the re-screen to `generateRecipe` (third check, after allergies):

```ts
      const recipe = await gen(req);
      if (!energyConsistent(recipe.perServing)) continue;
      if (violatesAllergies(recipe.ingredients, req.allergies).length > 0) continue;
      if (lacksEquipment(recipe.equipment, req.equipment).length > 0) continue;
      return recipe;
```

Add an equipment line to the estimator prompt (so the helper suggests `equipment[]`). In `aiEstimator`, insert before `UNIT_GUIDANCE`:

```ts
      `kcal must equal 4*protein + 4*carbs + 9*fat within 10%.`,
      `In the "equipment" field, list any special cooking capabilities the method implies, chosen ONLY from: ${CAPABILITIES.join(', ')}. Use an empty array if none.`,
      `Assign each ingredient a realistic supermarket section.`,
```

and add `CAPABILITIES` to the equipment import:

```ts
import { CAPABILITIES, lacksEquipment, type Benefit } from '@/lib/macro/equipment';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/ai/recipes.test.ts`
Expected: PASS — re-screen rejects/accepts as specified; existing energy/allergy tests still green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/recipes.ts src/lib/ai/recipes.test.ts
git commit -m "feat: equipment-aware AI prompt and re-screen"
```

---

### Task 4: Planner — favourite biasing + per-day benefit

**Files:**
- Modify: `src/lib/planner/draft.ts`
- Modify: `src/lib/planner/draft.test.ts`

**Interfaces:**
- Consumes: `scoreFavourite`, `standoutTags`, `dayBenefit`, `Benefit` from `@/lib/macro/equipment`.
- Produces: `DraftGenerateRequest` gains `preferBenefit: Benefit`. `draftWeek` opts gain optional `equipment?: string[]` (household capabilities). Favourites are chosen by bias score; AI slots carry the day's benefit.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/planner/draft.test.ts`. Extend the `fav` factory to accept equipment, then add biasing cases:

```ts
const favEq = (name: string, cuisine: string, equipment: string[], tags: string[] = []): FavouriteRecipe => ({
  ...fav(name, cuisine, tags), equipment,
});

describe('draftWeek equipment biasing', () => {
  it('prefers a favourite that uses standout gear the household has', async () => {
    const favourites = [favEq('Plain pasta', 'italian', []), favEq('Steam salmon', 'italian', ['steam'])];
    const days = await draftWeek({
      favourites, cuisines: ['italian'], recentNames: [],
      pinned: new Map(), vegetarianNights: 0, rng: () => 0, equipment: ['steam'],
      generate: async () => null,
    });
    // day 0 is a favourite slot (day % 2 === 0); the steam dish should win it.
    expect(days.find((d) => d.day === 0)?.recipe.name).toBe('Steam salmon');
  });

  it('passes the day benefit to the AI generator (speed weeknight, quality weekend)', async () => {
    // All 7 days are AI (no favourites). Capture the benefit keyed by the slot's day.
    const byDay: Record<number, string> = {};
    await draftWeek({
      favourites: [], cuisines: ['italian'], recentNames: [],
      pinned: new Map(), vegetarianNights: 0, rng: () => 0, equipment: ['steam', 'air-fry'],
      generate: async (req) => { byDay[req.day] = req.preferBenefit; return null; },
    });
    expect(byDay[0]).toBe('speed');   // Mon
    expect(byDay[3]).toBe('speed');   // Thu
    expect(byDay[4]).toBe('quality'); // Fri
    expect(byDay[6]).toBe('quality'); // Sun
  });
});
```

NOTE: this requires the AI generate request to also expose `day`. Add `day: number` to `DraftGenerateRequest` so the captured benefit can be keyed by day in the test and so downstream callers know the slot. (The real planner already knows the day; passing it through is free.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/planner/draft.test.ts`
Expected: FAIL — `equipment` opt and `preferBenefit`/`day` on the generate request don't exist.

- [ ] **Step 3: Implement biasing in `draft.ts`**

Update imports and `DraftGenerateRequest`:

```ts
import type { RecipeData } from '@/lib/macro/types';
import type { AiRecipe } from '@/lib/ai/schema';
import { scoreFavourite, standoutTags, dayBenefit, type Benefit } from '@/lib/macro/equipment';
```

```ts
export type DraftGenerateRequest = {
  day: number;
  cuisine: string;
  dietTags: string[];
  avoidNames: string[];
  preferBenefit: Benefit;
};
```

Replace `pickFavourite` with the biased version:

```ts
function pickFavourite(
  favourites: FavouriteRecipe[],
  cuisine: string | null,
  used: Set<string>,
  dietTags: string[],
  bias: { day: number; household: string[]; prevStandout: string[] },
): FavouriteRecipe | null {
  const fresh = favourites.filter(
    (f) =>
      !used.has(f.name.toLowerCase()) &&
      dietTags.every((t) => f.tags.includes(t)) &&
      (cuisine === null || cuisine === 'any' || f.cuisine.toLowerCase() === cuisine.toLowerCase()),
  );
  if (fresh.length === 0) return null;
  // Stable sort by descending bias score; ties keep insertion order (preserves the
  // old "first match" behaviour when no equipment signal applies).
  return [...fresh]
    .map((f, i) => ({ f, i, s: scoreFavourite(f, bias) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)[0].f;
}
```

In `draftWeek`, add `equipment?: string[]` to opts and thread the bias. Replace the opts type and Phase 1 loop:

```ts
export async function draftWeek(opts: {
  favourites: FavouriteRecipe[];
  cuisines: string[];
  recentNames: string[];
  pinned: Map<number, DraftDinner>;
  vegetarianNights: number;
  equipment?: string[];
  generate: (req: DraftGenerateRequest) => Promise<AiRecipe | null>;
  rng?: () => number;
}): Promise<DraftDinner[]> {
  const seq = cuisineSequence(opts.cuisines, 7, opts.rng);
  const used = new Set(opts.recentNames.map((n) => n.toLowerCase()));
  for (const p of opts.pinned.values()) used.add(p.recipe.name.toLowerCase());
  const household = opts.equipment ?? [];

  let vegRemaining = opts.vegetarianNights;
  const result: (DraftDinner | null)[] = new Array(7).fill(null);
  const aiSlots: { day: number; cuisine: string; dietTags: string[] }[] = [];

  // Phase 1 (no I/O): place pinned and favourite dinners, collect the days needing AI.
  for (let day = 0; day < 7; day++) {
    const pinnedDinner = opts.pinned.get(day);
    if (pinnedDinner) { result[day] = pinnedDinner; continue; }

    const cuisine = seq[day];
    const dietTags = vegRemaining > 0 ? ['vegetarian'] : [];
    const prev = day > 0 ? result[day - 1] : null;
    const prevStandout = prev ? standoutTags(prev.recipe.equipment) : [];
    const wantFavourite = day % 2 === 0; // ~half favourites, half AI
    const favMatch = pickFavourite(opts.favourites, cuisine, used, dietTags, { day, household, prevStandout });

    if (wantFavourite && favMatch) {
      result[day] = { day, source: 'favourite', recipeId: favMatch.id, recipe: favMatch };
      used.add(favMatch.name.toLowerCase());
      if (dietTags.length) vegRemaining--;
    } else {
      aiSlots.push({ day, cuisine, dietTags });
      if (dietTags.length) vegRemaining--;
    }
  }
```

In Phase 2, pass `day` and `preferBenefit` on each generate call:

```ts
    const results = await Promise.all(
      pending.map((slot) =>
        opts.generate({
          day: slot.day, cuisine: slot.cuisine, dietTags: slot.dietTags,
          avoidNames: [...used], preferBenefit: dayBenefit(slot.day),
        }),
      ),
    );
```

In Phase 3, pass the bias object to `pickFavourite`:

```ts
  for (const slot of pending) {
    const prev = slot.day > 0 ? result[slot.day - 1] : null;
    const prevStandout = prev ? standoutTags(prev.recipe.equipment) : [];
    const bias = { day: slot.day, household, prevStandout };
    const fav =
      pickFavourite(opts.favourites, slot.cuisine, used, slot.dietTags, bias) ??
      pickFavourite(opts.favourites, null, used, [], bias);
    if (fav) {
      used.add(fav.name.toLowerCase());
      result[slot.day] = { day: slot.day, source: 'favourite', recipeId: fav.id, recipe: fav };
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/planner/draft.test.ts`
Expected: PASS — biasing picks the steam favourite; benefit is speed early / quality late. Pre-existing draft tests still pass (they omit `equipment`, defaulting to `[]`, so scores are all 0 and order is unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/lib/planner/draft.ts src/lib/planner/draft.test.ts
git commit -m "feat: bias weekly draft toward standout gear with per-day benefit"
```

---

### Task 5: Wire household equipment through the planning service

**Files:**
- Modify: `src/lib/services/planning.ts`
- Create: `src/lib/services/planning.test.ts`

**Interfaces:**
- Consumes: `dayBenefit` from `@/lib/macro/equipment`; the updated `RecipeRequest`, `DraftGenerateRequest`, and `draftWeek` opts.
- Produces: `planWeek` and `swapDay` pass `ctx.config.equipment` and the per-day benefit into generation; `draftWeek` receives `equipment`.

- [ ] **Step 1: Write the failing integration test**

```ts
// src/lib/services/planning.test.ts
import { describe, expect, it } from 'vitest';
import { createTestDb } from '@/lib/test/db';
import { people, recipes, settings, plannedDinners } from '@/lib/db/schema';
import { planWeek } from './planning';
import type { Generator } from '@/lib/ai/recipes';

const adult = {
  name: 'A', age: 40, sex: 'male' as const, weightKg: 80, heightCm: 180,
  activity: 'moderate' as const, goal: 'maintain' as const, allergies: [], dislikes: [],
};

const makeAi = (equipment: string[]): Generator => async (req) => ({
  name: `AI ${req.cuisine} ${Math.random()}`, cuisine: req.cuisine, method: 'cook', servings: 4,
  perServing: { kcal: 600, protein: 40, carbs: 55, fat: 20 }, tags: req.dietTags, equipment,
  ingredients: [{ name: 'thing', quantity: 1, unit: 'pcs', section: 'other' }],
});

describe('planWeek equipment re-screen', () => {
  it('never persists a recipe needing gear the household lacks', async () => {
    const db = await createTestDb();
    await db.insert(people).values(adult);
    await db.insert(settings).values({ id: 1, cuisines: ['italian'], equipment: ['steam'] });

    // Generator always returns a recipe needing sous-vide, which the household lacks.
    const { aiDegraded } = await planWeek(db, '2026-06-29', makeAi(['sous-vide']));

    const planned = await db.select().from(plannedDinners);
    const planatedRecipes = await db.select().from(recipes);
    // Re-screen rejects every AI recipe → no AI dinners persisted, week is favourites-only (empty here).
    expect(planatedRecipes.every((r) => r.equipment.every((e) => ['steam'].includes(e)))).toBe(true);
    expect(planned.length).toBe(0);
    expect(aiDegraded).toBe(true);
  });

  it('persists AI recipes that only use available gear', async () => {
    const db = await createTestDb();
    await db.insert(people).values(adult);
    await db.insert(settings).values({ id: 1, cuisines: ['italian'], equipment: ['steam'] });

    await planWeek(db, '2026-06-29', makeAi(['steam']));

    const planatedRecipes = await db.select().from(recipes);
    expect(planatedRecipes.length).toBeGreaterThan(0);
    expect(planatedRecipes.every((r) => r.equipment).every(Boolean)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/services/planning.test.ts`
Expected: FAIL — `planWeek` doesn't yet pass `equipment` into the request, so `lacksEquipment` sees an empty household and accepts the sous-vide recipe (first test fails on `planned.length`).

- [ ] **Step 3: Wire equipment through `planning.ts`**

Add the import:

```ts
import { dayBenefit } from '@/lib/macro/equipment';
```

In `planWeek`, update the `generate` closure to forward equipment and benefit:

```ts
  const generate = async (req: DraftGenerateRequest) => {
    aiRequested++;
    const result = await generateRecipe(
      {
        cuisine: req.cuisine, targetPerServing: ctx.avgTarget,
        allergies: ctx.allergies, dislikes: ctx.dislikes,
        dietTags: req.dietTags, avoidNames: req.avoidNames,
        equipment: ctx.config.equipment, preferBenefit: req.preferBenefit,
      },
      gen,
    );
    if (result !== null) aiSucceeded++;
    return result;
  };
```

Pass `equipment` into the `draftWeek` call:

```ts
  const days = await draftWeek({
    favourites: ctx.favourites, cuisines: ctx.config.cuisines,
    recentNames: recent.map((r) => r.name),
    pinned, vegetarianNights: ctx.config.vegetarianNights,
    equipment: ctx.config.equipment, generate,
  });
```

In `swapDay`, update the AI branch to pass equipment and the day's benefit:

```ts
    const ai = await generateRecipe(
      {
        cuisine, targetPerServing: ctx.avgTarget,
        allergies: ctx.allergies, dislikes: ctx.dislikes,
        dietTags: [], avoidNames: [...usedNames],
        equipment: ctx.config.equipment, preferBenefit: dayBenefit(day),
      },
      gen,
    );
```

- [ ] **Step 4: Run the test and full suite**

Run: `npx vitest run src/lib/services/planning.test.ts && npm test && npx tsc --noEmit`
Expected: PASS — unavailable-gear recipes are never persisted; available-gear recipes are; everything else compiles.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/planning.ts src/lib/services/planning.test.ts
git commit -m "feat: thread household equipment through planning and swaps"
```

---

### Task 6: Family page — equipment picker

**Files:**
- Modify: `src/app/(app)/family/page.tsx`
- Modify: `src/app/actions/family.ts`

**Interfaces:**
- Consumes: `CAPABILITIES` from `@/lib/macro/equipment`; `settings.equipment` column.
- Produces: the household settings form persists `equipment` (a `string[]` of capability tags).

- [ ] **Step 1: Read equipment into the page and render checkboxes**

In `src/app/(app)/family/page.tsx`, add the import:

```ts
import { CAPABILITIES } from '@/lib/macro/equipment';
```

Inside the "Household settings" `<form action={saveSettings}>`, add a checkbox group before the Save button (after the Vegetarian-nights label):

```tsx
          <fieldset className="w-full">
            <legend className="mb-1">Kitchen equipment</legend>
            <div className="flex flex-wrap gap-3">
              {CAPABILITIES.map((cap) => (
                <label key={cap} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    name="equipment"
                    value={cap}
                    defaultChecked={(config?.equipment ?? []).includes(cap)}
                  />
                  {cap}
                </label>
              ))}
            </div>
          </fieldset>
```

- [ ] **Step 2: Persist equipment in the action**

In `src/app/actions/family.ts`, update `saveSettings` to read the checkbox group:

```ts
export async function saveSettings(formData: FormData) {
  const db = getDb();
  const values = {
    dinnerShare: Number(formData.get('dinnerShare')) / 100,
    cuisines: list(formData.get('cuisines')),
    equipment: formData.getAll('equipment').map(String),
    vegetarianNights: Number(formData.get('vegetarianNights')),
  };
  await db.insert(settings).values({ id: 1, ...values })
    .onConflictDoUpdate({ target: settings.id, set: values });
  revalidatePath('/family');
}
```

- [ ] **Step 3: Verify build and types**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS — the page compiles and builds.

- [ ] **Step 4: Manual verification**

Run: `npm run dev`, open `/family`, tick `steam` and `air-fry`, Save. Reload — the same boxes stay checked (confirms round-trip through `settings.equipment`).

- [ ] **Step 5: Commit**

```bash
git add src/app/(app)/family/page.tsx src/app/actions/family.ts
git commit -m "feat: kitchen equipment picker on family settings"
```

---

### Task 7: Recipes page — equipment on add form, display, and AI estimate

**Files:**
- Modify: `src/app/(app)/recipes/page.tsx`
- Modify: `src/app/actions/recipes.ts`

**Interfaces:**
- Consumes: `CAPABILITIES` from `@/lib/macro/equipment`; `MacroEstimate.equipment`; `recipes.equipment` column.
- Produces: manual recipes persist chosen equipment; the AI estimate fills it when available; favourite cards show equipment tags.

- [ ] **Step 1: Render equipment checkboxes on the add-recipe form**

In `src/app/(app)/recipes/page.tsx`, add the import:

```ts
import { CAPABILITIES } from '@/lib/macro/equipment';
```

In the "Add recipe" form, add a checkbox group before the estimate checkbox/label:

```tsx
          <fieldset>
            <legend className="text-gray-600">Equipment used (optional)</legend>
            <div className="flex flex-wrap gap-3">
              {CAPABILITIES.map((cap) => (
                <label key={cap} className="flex items-center gap-1">
                  <input type="checkbox" name="equipment" value={cap} />
                  {cap}
                </label>
              ))}
            </div>
          </fieldset>
```

Show equipment on each favourite card — extend the macros paragraph:

```tsx
              <p className="text-gray-600">
                {r.cuisine} · {Math.round(r.perServing.kcal)} kcal · P{Math.round(r.perServing.protein)} C{Math.round(r.perServing.carbs)} F{Math.round(r.perServing.fat)}
                {r.tags.length > 0 && <> · {r.tags.join(', ')}</>}
                {r.equipment.length > 0 && <> · 🍳 {r.equipment.join(', ')}</>}
              </p>
```

- [ ] **Step 2: Persist equipment in `saveRecipe`**

In `src/app/actions/recipes.ts`, read the checkbox group and let the AI estimate override it. Replace the body from the `perServing`/`ingredients` setup through the insert:

```ts
  let perServing = {
    kcal: Number(formData.get('kcal')) || 0,
    protein: Number(formData.get('protein')) || 0,
    carbs: Number(formData.get('carbs')) || 0,
    fat: Number(formData.get('fat')) || 0,
  };
  let ingredients = parseIngredientLines(ingredientLines);
  let equipment = formData.getAll('equipment').map(String);

  if (useAi) {
    const estimate = await estimateRecipe({ name, servings, ingredientLines });
    if (estimate) {
      perServing = estimate.perServing;
      ingredients = estimate.ingredients;
      if (estimate.equipment.length > 0) equipment = estimate.equipment;
    }
    // AI down — fall back to whatever was typed, never block saving
  }

  await db.insert(recipes).values({
    name,
    cuisine: String(formData.get('cuisine')) || 'any',
    method: String(formData.get('method') ?? ''),
    servings,
    perServing,
    tags: String(formData.get('tags') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    equipment,
    source: 'family',
    ingredients,
  });
  revalidatePath('/recipes');
```

- [ ] **Step 3: Verify build and types**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 4: Manual verification**

Run: `npm run dev`, open `/recipes`, add a recipe with `steam` ticked and the AI-estimate box unticked — it appears under Favourites with "🍳 steam". (With AI estimate on, the estimate may overwrite the ticks; that is intended.)

- [ ] **Step 5: Commit**

```bash
git add src/app/(app)/recipes/page.tsx src/app/actions/recipes.ts
git commit -m "feat: equipment on recipe form, display, and AI estimate"
```

---

### Task 8: Plan page — standout appliance badge

**Files:**
- Modify: `src/app/(app)/page.tsx`

**Interfaces:**
- Consumes: `standoutTags` from `@/lib/macro/equipment`; `dinner.recipe.equipment`.
- Produces: a badge on day cards whose recipe uses a standout capability.

- [ ] **Step 1: Add the import**

In `src/app/(app)/page.tsx`:

```ts
import { standoutTags } from '@/lib/macro/equipment';
```

- [ ] **Step 2: Render the badge**

In the day-card body, right under the recipe name line, add the badge (only standout tags, so baseline gear never shows):

```tsx
                  <p className="font-medium">{dinner.recipe.name}</p>
                  {standoutTags(dinner.recipe.equipment).length > 0 && (
                    <p className="text-xs text-sky-700" title={standoutTags(dinner.recipe.equipment).join(', ')}>
                      🫧 {standoutTags(dinner.recipe.equipment).join(', ')}
                    </p>
                  )}
```

- [ ] **Step 3: Verify build and types**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 4: Manual verification**

Run: `npm run dev`, set kitchen equipment to include `steam` on `/family`, then "Plan my week" on `/`. Any dinner the AI wrote for the steam oven shows a `🫧 steam` badge; plain stovetop dinners show none.

- [ ] **Step 5: Run the full suite once more and commit**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

```bash
git add 'src/app/(app)/page.tsx'
git commit -m "feat: standout appliance badge on plan day cards"
```

---

## Self-Review

**Spec coverage:**

- Capability vocabulary (closed set) → Task 1 (`CAPABILITIES`), Global Constraints.
- Standout vs baseline → Task 1 (`STANDOUT`, `standoutTags`); badge Task 8; biasing Task 4.
- Benefit map (quality/speed) + weeknight/weekend → Task 1 (`BENEFIT`, `dayBenefit`); applied Task 4 (favourites) and Tasks 3/5 (AI prompt `preferBenefit`).
- `recipes.equipment` + `settings.equipment` columns, defaults, optional/empty → Task 2.
- Method written for this kitchen (prompt requirements: moisture %, 100 °C physics, single cavity, grill meaning) → Task 3 (`EQUIPMENT_GUIDANCE`, `buildPrompt`).
- Equipment re-screen (reject → silent regenerate) → Task 3 (`generateRecipe`), proven end-to-end in Task 5.
- Soft preference + method spread → Task 4 (`scoreFavourite` +2/+1/−2, prev-night penalty).
- AI estimate suggests equipment → Task 3 (estimator prompt) + Task 7 (consumed in `saveRecipe`).
- UI: equipment picker (Task 6), badge (Task 8), recipe form/display (Task 7).
- Pure-engine impact: re-screen and scoring are pure, unit-tested (Tasks 1, 4); macro arithmetic untouched.
- Cost/fallback unchanged: no new calls/model; favourites-only fallback ignores equipment (Task 5 first test asserts `aiDegraded`).
- Testing strategy: unit (Task 1, 4), integration (Task 2 columns, Task 5 planning); AI mocked everywhere.

**Placeholder scan:** none — every code step shows complete content.

**Type consistency:** `equipment: string[]` consistent across `RecipeData`, `AiRecipe`, `MacroEstimate`, and the DB columns. `Benefit` reused from `equipment.ts` in `recipes.ts` and `draft.ts`. `DraftGenerateRequest` gains `day` + `preferBenefit`, consumed identically in `draft.ts` Phase 2 and produced by the `planning.ts` closure. `scoreFavourite`/`standoutTags`/`lacksEquipment`/`dayBenefit` signatures match all call sites.
