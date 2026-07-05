# Ingredient Canon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge shopping-list lines that are the same purchase — same ingredient split by unit (`3 pcs onion` + `337.5 g onion`) or by synonym (`scallion` + `green onion`) — into one buyable line.

**Architecture:** A new pure module `src/lib/macro/canon.ts` holds curated tables (synonyms, per-piece weights, waterlike densities) and two functions (`canonicalName`, `toBuyable`). `aggregate.ts`'s `merge()` applies both before the exclusion check and merge key, so unit- and synonym-splits collapse and the staple filter becomes synonym-aware. Two sentences added to the AI `UNIT_GUIDANCE` prevent new drift. No schema, service, or UI changes.

**Tech Stack:** TypeScript, Vitest. Macro layer only (pure, deterministic, no I/O) plus one prompt constant.

## Global Constraints

- **Layering:** `src/lib/macro/` is pure, deterministic, dependency-free, no I/O.
- **Fallback is today's behavior:** anything the canon doesn't know keeps the original spec's "incompatible units stay separate" rule. `toBuyable` never throws.
- **Non-goals (do NOT implement):** no merging of rice varieties or `tofu`/`firm tofu`; no canon UI; no `≈` display marker.
- **Curated values (exact, from spec):** SYNONYMS: `scallion→green onion`, `spring onion→green onion`, `capsicum→bell pepper`, `courgette→zucchini`, `aubergine→eggplant`, `coriander→cilantro`, `fresh coriander→cilantro`, `garbanzo bean→chickpea`. PER-PIECE grams: onion 150, bell pepper 120, tomato 120, lemon 100, lime 70, carrot 60, zucchini 200, potato 170, cucumber 300, avocado 170, apple 180, egg 55; garlic 3 g per **clove** (target unit `clove`, not `pcs`). WATERLIKE (`1 ml ≈ 1 g`, unify to `g`): sour cream, yogurt, milk, cream.
- Existing behavior that must keep working: unit synonym canonicalization (`tablespoon→tbsp`), count-unit ceiling (`pcs/can/clove/slice` round up after merging), `water` exclusion, staple filtering, section-then-name sort.

## File Structure

- **Create** `src/lib/macro/canon.ts` — tables + `canonicalName` + `toBuyable`. One responsibility: ingredient identity and buyable-unit conversion.
- **Create** `src/lib/macro/canon.test.ts`.
- **Modify** `src/lib/macro/aggregate.ts` — apply the canon inside `merge()`; canonicalize staple names in `aggregateIngredients`/`staplesUsed`.
- **Modify** `src/lib/macro/aggregate.test.ts` — end-to-end merge cases.
- **Modify** `src/lib/ai/recipes.ts` — `UNIT_GUIDANCE` additions (Task 3).

---

### Task 1: The canon module

**Files:**
- Create: `src/lib/macro/canon.ts`
- Test: `src/lib/macro/canon.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `canonicalName(name: string): string` — trimmed, lowercased, synonym-resolved.
  - `toBuyable(item: { name: string; quantity: number; unit: string }): { name: string; quantity: number; unit: string }` — `item.name` must already be canonical and `item.unit` already canon (`g`, `kg`, `ml`, `l`, `pcs`, …). Converts known produce `g/kg → pcs|clove` and waterlike `ml/l → g`; otherwise returns the item unchanged.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/macro/canon.test.ts
import { describe, expect, it } from 'vitest';
import { canonicalName, toBuyable } from './canon';

describe('canonicalName', () => {
  it('resolves synonyms case-insensitively', () => {
    expect(canonicalName('Scallion')).toBe('green onion');
    expect(canonicalName('spring onion')).toBe('green onion');
    expect(canonicalName('Capsicum')).toBe('bell pepper');
    expect(canonicalName('fresh coriander')).toBe('cilantro');
  });
  it('passes unknown names through, lowercased and trimmed', () => {
    expect(canonicalName('  Basmati Rice ')).toBe('basmati rice');
  });
});

describe('toBuyable', () => {
  it('converts grams of known produce to pieces', () => {
    expect(toBuyable({ name: 'onion', quantity: 337.5, unit: 'g' }))
      .toEqual({ name: 'onion', quantity: 2.25, unit: 'pcs' });
  });
  it('converts kilograms of known produce to pieces', () => {
    expect(toBuyable({ name: 'potato', quantity: 1.7, unit: 'kg' }))
      .toEqual({ name: 'potato', quantity: 10, unit: 'pcs' });
  });
  it('converts grams of garlic to cloves, not pieces', () => {
    expect(toBuyable({ name: 'garlic', quantity: 11.25, unit: 'g' }))
      .toEqual({ name: 'garlic', quantity: 3.75, unit: 'clove' });
  });
  it('unifies waterlike ml (and l) to g', () => {
    expect(toBuyable({ name: 'sour cream', quantity: 75, unit: 'ml' }))
      .toEqual({ name: 'sour cream', quantity: 75, unit: 'g' });
    expect(toBuyable({ name: 'milk', quantity: 0.5, unit: 'l' }))
      .toEqual({ name: 'milk', quantity: 500, unit: 'g' });
  });
  it('leaves already-buyable and unknown items unchanged', () => {
    expect(toBuyable({ name: 'onion', quantity: 3, unit: 'pcs' }))
      .toEqual({ name: 'onion', quantity: 3, unit: 'pcs' });
    expect(toBuyable({ name: 'chicken breast', quantity: 500, unit: 'g' }))
      .toEqual({ name: 'chicken breast', quantity: 500, unit: 'g' });
    expect(toBuyable({ name: 'olive oil', quantity: 2, unit: 'tbsp' }))
      .toEqual({ name: 'olive oil', quantity: 2, unit: 'tbsp' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/macro/canon.test.ts`
Expected: FAIL — cannot find module `./canon`.

- [ ] **Step 3: Write the module**

```ts
// src/lib/macro/canon.ts
// Curated ingredient identity + buyable-unit conversion for shopping lists.
// Pure and deterministic, like the rest of src/lib/macro — no I/O.
// Fallback contract: anything not in these tables passes through unchanged,
// preserving the original "incompatible units stay separate" behaviour.

const SYNONYMS: Record<string, string> = {
  scallion: 'green onion',
  'spring onion': 'green onion',
  capsicum: 'bell pepper',
  courgette: 'zucchini',
  aubergine: 'eggplant',
  coriander: 'cilantro',
  'fresh coriander': 'cilantro',
  'garbanzo bean': 'chickpea',
};

// Whole items bought by count: average weight of one, and the unit you buy.
const BUYABLE: Record<string, { unit: 'pcs' | 'clove'; grams: number }> = {
  onion: { unit: 'pcs', grams: 150 },
  'bell pepper': { unit: 'pcs', grams: 120 },
  tomato: { unit: 'pcs', grams: 120 },
  lemon: { unit: 'pcs', grams: 100 },
  lime: { unit: 'pcs', grams: 70 },
  carrot: { unit: 'pcs', grams: 60 },
  zucchini: { unit: 'pcs', grams: 200 },
  potato: { unit: 'pcs', grams: 170 },
  cucumber: { unit: 'pcs', grams: 300 },
  avocado: { unit: 'pcs', grams: 170 },
  apple: { unit: 'pcs', grams: 180 },
  egg: { unit: 'pcs', grams: 55 },
  garlic: { unit: 'clove', grams: 3 },
};

// Products where 1 ml ≈ 1 g; mixed ml/g lines unify to g.
const WATERLIKE = new Set(['sour cream', 'yogurt', 'milk', 'cream']);

/** Trim, lowercase, resolve synonyms. Unknown names pass through. */
export function canonicalName(name: string): string {
  const n = name.trim().toLowerCase();
  return SYNONYMS[n] ?? n;
}

/**
 * Convert a canonical-named, canon-unit item toward the unit you actually buy.
 * g/kg of known produce → pcs (garlic → clove); ml/l of waterlike → g.
 * Everything else is returned unchanged. Never throws.
 */
export function toBuyable(item: { name: string; quantity: number; unit: string }) {
  const buy = BUYABLE[item.name];
  if (buy && (item.unit === 'g' || item.unit === 'kg')) {
    const grams = item.unit === 'kg' ? item.quantity * 1000 : item.quantity;
    return { name: item.name, quantity: grams / buy.grams, unit: buy.unit };
  }
  if (WATERLIKE.has(item.name) && (item.unit === 'ml' || item.unit === 'l')) {
    const ml = item.unit === 'l' ? item.quantity * 1000 : item.quantity;
    return { name: item.name, quantity: ml, unit: 'g' };
  }
  return item;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/macro/canon.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/macro/canon.ts src/lib/macro/canon.test.ts
git commit -m "feat: ingredient canon — synonyms and buyable-unit conversion"
```

---

### Task 2: Apply the canon in aggregation

**Files:**
- Modify: `src/lib/macro/aggregate.ts`
- Test: `src/lib/macro/aggregate.test.ts`

**Interfaces:**
- Consumes: `canonicalName`, `toBuyable` from `./canon` (Task 1 signatures).
- Produces: unchanged public API (`aggregateIngredients`, `staplesUsed`, `SECTION_ORDER`, types) — behavior change only.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/macro/aggregate.test.ts` (the `ing` factory already exists at the top of the file):

```ts
describe('ingredient canon merging', () => {
  it('merges pcs and grams of the same produce into ceiled pieces', () => {
    const items = aggregateIngredients(
      [
        { ingredients: [ing('onion', 3, 'pcs', 'produce')], scale: 1 },
        { ingredients: [ing('onion', 337.5, 'g', 'produce')], scale: 1 },
      ],
      [],
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: 'onion', quantity: 6, unit: 'pcs' }); // 3 + 2.25 → ceil
  });
  it('merges clove and grams of garlic into ceiled cloves', () => {
    const items = aggregateIngredients(
      [{ ingredients: [ing('garlic', 12, 'clove', 'produce'), ing('garlic', 11.25, 'g', 'produce')], scale: 1 }],
      [],
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ quantity: 16, unit: 'clove' }); // 12 + 3.75 → ceil
  });
  it('merges waterlike ml and g into grams', () => {
    const items = aggregateIngredients(
      [{ ingredients: [ing('sour cream', 75, 'ml', 'dairy'), ing('sour cream', 150, 'g', 'dairy')], scale: 1 }],
      [],
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ quantity: 225, unit: 'g' });
  });
  it('merges synonym-split lines (scallion + green onion)', () => {
    const items = aggregateIngredients(
      [{ ingredients: [ing('scallion', 2, 'pcs', 'produce'), ing('green onion', 1, 'pcs', 'produce')], scale: 1 }],
      [],
    );
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('green onion');
    expect(items[0].quantity).toBe(3);
  });
  it('does not merge distinct products that look similar', () => {
    const items = aggregateIngredients(
      [{ ingredients: [ing('basmati rice', 330, 'g', 'pantry'), ing('brown rice', 180, 'g', 'pantry'), ing('white rice', 180, 'g', 'pantry')], scale: 1 }],
      [],
    );
    expect(items).toHaveLength(3);
  });
  it('filters staples by canonical name (staple "green onion" catches scallion)', () => {
    const items = aggregateIngredients(
      [{ ingredients: [ing('Scallion', 2, 'pcs', 'produce'), ing('chicken breast', 500, 'g', 'meat_fish')], scale: 1 }],
      ['green onion'],
    );
    expect(items.map((i) => i.name)).toEqual(['chicken breast']);
  });
  it('reports staple usage under the canonical name and buyable unit', () => {
    const used = staplesUsed(
      [{ ingredients: [ing('spring onion', 37.5, 'g', 'produce')], scale: 1 }],
      ['green onion'],
    );
    expect(used).toHaveLength(1);
    expect(used[0].name).toBe('green onion');
  });
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run src/lib/macro/aggregate.test.ts`
Expected: the seven new tests FAIL (split lines / staple misses); all pre-existing tests still PASS.

- [ ] **Step 3: Apply the canon inside `merge()`**

In `src/lib/macro/aggregate.ts`, add the import and rework `merge()` and the two callers. The current `merge()` keys on `norm(i.name)|canonUnit(i.unit)`; the canon slots in between:

```ts
import { canonicalName, toBuyable } from './canon';
```

```ts
function merge(dinners: ScaledRecipe[], include: (name: string) => boolean): ShoppingItem[] {
  const map = new Map<string, ShoppingItem>();
  for (const { ingredients, scale } of dinners) {
    for (const i of ingredients) {
      const name = canonicalName(i.name);
      if (!include(name)) continue;
      // Convert toward the buyable unit BEFORE keying, so "337.5 g onion"
      // and "3 pcs onion" land on the same pcs line.
      const b = toBuyable({ name, quantity: i.quantity * scale, unit: canonUnit(i.unit) });
      const key = `${b.name}|${b.unit}`;
      const existing = map.get(key);
      if (existing) existing.quantity += b.quantity;
      else map.set(key, { name: b.name, quantity: b.quantity, unit: b.unit, section: i.section });
    }
  }
  return [...map.values()].map(shoppable).sort(
    (a, b) => SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section) || a.name.localeCompare(b.name),
  );
}
```

Then canonicalize staple names in both callers so the filter is synonym-aware:

```ts
export function aggregateIngredients(dinners: ScaledRecipe[], staples: string[]): ShoppingItem[] {
  const stapleSet = new Set(staples.map(canonicalName));
  return merge(dinners, (name) => !stapleSet.has(name) && !ALWAYS_EXCLUDED.has(name));
}

export function staplesUsed(dinners: ScaledRecipe[], staples: string[]): ShoppingItem[] {
  const stapleSet = new Set(staples.map(canonicalName));
  return merge(dinners, (name) => stapleSet.has(name));
}
```

Note the scale move: quantity is now scaled once when building `b` (`i.quantity * scale`) instead of at insert time — keep it in exactly one place. The existing `norm` helper stays for `canonUnit`; stored item names become canonical (lowercased) — the UI already renders them inline, so this only normalizes display casing.

- [ ] **Step 4: Run the full aggregate suite to verify green**

Run: `npx vitest run src/lib/macro/aggregate.test.ts src/lib/macro/canon.test.ts`
Expected: PASS — all new tests and every pre-existing case (unit synonyms, ceiling, water exclusion, sorting, staples).

- [ ] **Step 5: Run the wider suite and typecheck**

Run: `npx vitest run src/lib && npx tsc --noEmit`
Expected: PASS (shopping service tests exercise `buildList` through this path; a pre-existing `.next/dev/types` tsc error may appear — ignore only that).

- [ ] **Step 6: Commit**

```bash
git add src/lib/macro/aggregate.ts src/lib/macro/aggregate.test.ts
git commit -m "feat: merge shopping lines via ingredient canon"
```

---

### Task 3: Prompt hardening

**Files:**
- Modify: `src/lib/ai/recipes.ts` (the `UNIT_GUIDANCE` constant)

**Interfaces:**
- Consumes: nothing new. Produces: nothing new — prompt text only, shared by `buildPrompt` and `aiEstimator` already.

- [ ] **Step 1: Extend `UNIT_GUIDANCE`**

In `src/lib/ai/recipes.ts`, replace the constant:

```ts
// Steer ingredient names/units toward a canonical form so the shopping-list aggregator
// can actually merge duplicates across recipes (see aggregate.ts UNIT_CANON and canon.ts).
const UNIT_GUIDANCE =
  'For each ingredient use a simple, singular, lowercase name with no brand or descriptor ' +
  'words (e.g. "onion" not "1 medium yellow onion", "chicken breast" not "boneless skinless ' +
  'chicken breasts"). Use only these units: g, kg, ml, l, tbsp, tsp, cup, pcs, clove, can, slice. ' +
  'Measure whole produce in pcs, not grams (e.g. "2 pcs onion", "1 pcs bell pepper"); use clove ' +
  'for garlic. Use one canonical name per ingredient: "green onion" not "scallion" or ' +
  '"spring onion", "cilantro" not "fresh coriander", "bell pepper" not "capsicum".';
```

- [ ] **Step 2: Verify the AI layer still passes and types are clean**

Run: `npx vitest run src/lib/ai/recipes.test.ts && npx tsc --noEmit`
Expected: PASS — no test asserts the prompt text; this confirms nothing structural broke.

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/recipes.ts
git commit -m "feat: steer AI toward canonical ingredient names and buyable units"
```

---

## Self-Review

**Spec coverage:** canon tables + both functions → Task 1 (values verbatim from spec). Aggregation integration incl. synonym-aware staple filter and unchanged fallback → Task 2. Prompt hardening → Task 3. Non-goals: no task touches rice/tofu merging, UI, or schema — and Task 2 has an explicit no-merge test for rice varieties.

**Placeholder scan:** none — full code in every step.

**Type consistency:** `canonicalName(name: string): string` and `toBuyable({name, quantity, unit})` identical in Task 1's module, Task 1's tests, and Task 2's `merge()`. `toBuyable` receives already-canonical name + already-canon unit in both. `BUYABLE`/`WATERLIKE`/`SYNONYMS` are private to the module (only the two functions are consumed).
