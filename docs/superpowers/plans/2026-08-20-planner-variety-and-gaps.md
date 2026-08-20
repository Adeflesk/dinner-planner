# Planner Variety and Gap Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the planner leaving nights empty and leaning on one cuisine, and make both failure modes visible in logs and in the UI.

**Architecture:** Cuisine policy moves out of `draft.ts` into a new pure module that never emits `'any'` and deals balanced sequences. `draftWeek` gains a per-cuisine cap on AI results (round 0 only) and an optional event callback so it stays I/O-free. `generateRecipe` strips model-invented equipment tags before screening, and logs a reason for every rejection. `planWeek` counts filled nights, forwards slot events to a new structured logger, and the Plan page reports a short week.

**Tech Stack:** TypeScript, Next.js 16 App Router, Vitest, Drizzle ORM, PGlite for integration tests, AI SDK v6 via Vercel AI Gateway.

**Spec:** `docs/superpowers/specs/2026-08-19-planner-variety-and-gaps-design.md`

## Global Constraints

- **Branch:** all work lands on `feature/planner-variety-and-gaps`, already created off `master`. The spec is already committed there.
- **Day indexing:** 0 = Monday … 6 = Sunday. Weeks are identified by `weekStart` (Monday, `YYYY-MM-DD`, UTC).
- **Three-layer architecture, strictly.** `src/lib/macro/` and `src/lib/planner/` are pure: no I/O, no logging, no `console.*`. Services (`src/lib/services/`, `src/lib/ai/`) orchestrate and may log. `src/app/` holds thin wrappers only.
- **No schema changes in this plan.** Nothing touches `src/lib/db/schema.ts`, so `db:generate` / `db:push` are not needed.
- **Tests never hit live models.** All AI is a fake generator passed as a parameter.
- **Run the full suite before every commit:** `npm test`. Baseline is 196 tests in 22 files, all passing.
- **Normalisation rule, used identically everywhere:** `(s) => s.trim().toLowerCase()`. Cuisines and equipment strings are compared this way and never any other way.
- **Banner copy, verbatim:** `Filled {filled} of 7 nights — {gaps} couldn't be generated. Use the swap buttons on those days to fill them.`
- **Commit style:** conventional prefixes (`feat:`, `fix:`, `test:`, `refactor:`, `docs:`), and every commit message ends with:

  ```text
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  ```

---

### Task 1: Cuisine policy module

**Files:**

- Create: `src/lib/planner/cuisines.ts`
- Test: `src/lib/planner/cuisines.test.ts`

**Interfaces:**

- Consumes: nothing (leaf module, no imports from the project).
- Produces:
  - `DEFAULT_CUISINES: readonly string[]` — 8 entries.
  - `effectiveCuisines(configured: string[]): string[]` — trims, drops blanks, dedupes case-insensitively keeping the first spelling; returns a mutable copy of `DEFAULT_CUISINES` when nothing is left.
  - `cuisineSequence(configured: string[], length: number, rng?: () => number): string[]`.

Background for the implementer: this module replaces a function of the same name currently in `src/lib/planner/draft.ts:22-35`. Do **not** delete the old one in this task — Task 2 does the swap. Right now the old function returns the literal string `'any'` when no cuisines are configured, which produces seven identical AI prompts and is the root cause of the whole feature.

The arrangement algorithm is the standard "most-remaining-first, never repeat the previous" greedy scheduler. Balanced dealing guarantees the largest count is at most `ceil(length / 2)` whenever there are 2+ cuisines, which is exactly the condition under which that greedy never gets stuck.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/planner/cuisines.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_CUISINES, cuisineSequence, effectiveCuisines } from './cuisines';

const counts = (seq: string[]) => {
  const m = new Map<string, number>();
  for (const c of seq) m.set(c, (m.get(c) ?? 0) + 1);
  return [...m.values()].sort((a, b) => b - a);
};

describe('effectiveCuisines', () => {
  it('returns the configured list when it has entries', () => {
    expect(effectiveCuisines(['Thai', 'Greek'])).toEqual(['Thai', 'Greek']);
  });
  it('falls back to the defaults when the list is empty', () => {
    expect(effectiveCuisines([])).toEqual([...DEFAULT_CUISINES]);
  });
  it('falls back when the list is only blanks', () => {
    expect(effectiveCuisines(['', '   '])).toEqual([...DEFAULT_CUISINES]);
  });
  it('trims and dedupes case-insensitively, keeping the first spelling', () => {
    expect(effectiveCuisines([' Thai ', 'thai', 'THAI', 'Greek'])).toEqual(['Thai', 'Greek']);
  });
  it('returns a copy, so callers cannot mutate the defaults', () => {
    const a = effectiveCuisines([]);
    a.push('Martian');
    expect(effectiveCuisines([])).toEqual([...DEFAULT_CUISINES]);
  });
});

describe('cuisineSequence', () => {
  it('never emits the placeholder "any"', () => {
    expect(cuisineSequence([], 7, () => 0)).not.toContain('any');
  });

  it('draws seven distinct cuisines from the defaults', () => {
    const seq = cuisineSequence([], 7, () => 0);
    expect(seq).toHaveLength(7);
    expect(new Set(seq).size).toBe(7);
    for (const c of seq) expect(DEFAULT_CUISINES).toContain(c);
  });

  it('deals balanced counts: no two cuisines differ by more than one', () => {
    for (const size of [2, 3, 4, 5]) {
      const source = Array.from({ length: size }, (_, i) => `c${i}`);
      const c = counts(cuisineSequence(source, 7, () => 0.5));
      expect(c[0] - c[c.length - 1]).toBeLessThanOrEqual(1);
    }
  });

  it('never schedules the same cuisine on adjacent days with 2+ cuisines', () => {
    for (const seed of [0, 0.25, 0.5, 0.99]) {
      const seq = cuisineSequence(['indian', 'mexican', 'italian'], 7, () => seed);
      for (let i = 1; i < seq.length; i++) expect(seq[i]).not.toBe(seq[i - 1]);
    }
  });

  it('fills every slot with the only cuisine when just one is configured', () => {
    expect(cuisineSequence(['italian'], 3, () => 0)).toEqual(['italian', 'italian', 'italian']);
  });

  it('is deterministic for a given rng', () => {
    const a = cuisineSequence([], 7, () => 0.3);
    const b = cuisineSequence([], 7, () => 0.3);
    expect(a).toEqual(b);
  });

  it('orders differently for different rng draws', () => {
    const a = cuisineSequence([], 7, () => 0);
    const b = cuisineSequence([], 7, () => 0.99);
    expect(a).not.toEqual(b);
  });

  it('returns an empty sequence for a non-positive length', () => {
    expect(cuisineSequence(['thai'], 0, () => 0)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/planner/cuisines.test.ts`

Expected: FAIL — `Failed to resolve import "./cuisines"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/planner/cuisines.ts`:

```ts
// Cuisine policy for the weekly draft: which cuisines are in play, and in what
// order the seven nights get them. Pure and dependency-free, like the macro
// engine — no I/O, no randomness beyond the injected rng.

/**
 * Used when the household has not set any preferred cuisines. Eight entries, so
 * a seven-night week draws seven distinct cuisines and no single cuisine can
 * dominate. The Family page overrides this whenever it is filled in.
 */
export const DEFAULT_CUISINES = [
  'Italian', 'Thai', 'Indian', 'Mexican',
  'Japanese', 'Greek', 'Middle Eastern', 'British',
] as const satisfies readonly string[];

const norm = (s: string) => s.trim().toLowerCase();

/**
 * The cuisine list actually in play: the household's own, cleaned up, or the
 * defaults when they have configured none. Exported separately because draftWeek
 * needs the size of this list to size its per-cuisine cap, and must not have to
 * guess whether the defaults were substituted.
 */
export function effectiveCuisines(configured: string[]): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of configured) {
    const trimmed = raw.trim();
    if (!trimmed || seen.has(norm(trimmed))) continue;
    seen.add(norm(trimmed));
    cleaned.push(trimmed);
  }
  return cleaned.length > 0 ? cleaned : [...DEFAULT_CUISINES];
}

function shuffle(items: string[], rng: () => number): string[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * A cuisine for each of `length` nights. Counts are balanced (any two differ by
 * at most one) and no cuisine falls on adjacent nights unless the household
 * configured only one. Never returns a placeholder — every slot names a real
 * cuisine, so the AI prompt is never the bare "any cuisine" that collapses the
 * model onto one style of food.
 */
export function cuisineSequence(
  configured: string[],
  length: number,
  rng: () => number = Math.random,
): string[] {
  if (length <= 0) return [];
  const order = shuffle(effectiveCuisines(configured), rng);

  // Balanced quota: the first `length % order.length` cuisines get one extra night.
  const remaining = new Map<string, number>();
  for (let i = 0; i < order.length; i++) {
    const quota = Math.floor(length / order.length) + (i < length % order.length ? 1 : 0);
    if (quota > 0) remaining.set(order[i], quota);
  }

  // Greedy arrangement: at each slot take the cuisine with the most nights left
  // that is not the previous night's. Balanced quotas keep the largest count at
  // or below ceil(length/2), which is exactly when this never paints itself into
  // a corner (with 2+ cuisines).
  const seq: string[] = [];
  let last = '';
  for (let i = 0; i < length; i++) {
    let best = '';
    for (const [cuisine, left] of remaining) {
      if (left <= 0 || cuisine === last) continue;
      if (best === '' || left > (remaining.get(best) ?? 0)) best = cuisine;
    }
    // Only the previous night's cuisine has nights left — a single-cuisine
    // household, where repeating is the correct answer.
    if (best === '') best = last;
    seq.push(best);
    remaining.set(best, (remaining.get(best) ?? 0) - 1);
    last = best;
  }
  return seq;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/planner/cuisines.test.ts`

Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/planner/cuisines.ts src/lib/planner/cuisines.test.ts
git commit -m "$(cat <<'EOF'
feat: cuisine policy module with a default rotation

cuisineSequence now deals balanced, non-adjacent sequences from the
household's cuisines, or from an eight-entry default rotation when they
have configured none. It never emits the 'any' placeholder that made all
seven AI prompts identical.

Not yet wired into draftWeek.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Wire `draftWeek` to the new module

**Files:**

- Modify: `src/lib/planner/draft.ts:1-6` (imports), `src/lib/planner/draft.ts:20-35` (delete the old `cuisineSequence`)
- Modify: `src/lib/planner/draft.test.ts:2` (import), `src/lib/planner/draft.test.ts:21-32` (the `cuisineSequence` describe block)

**Interfaces:**

- Consumes: `cuisineSequence` from Task 1.
- Produces: `draft.ts` no longer exports `cuisineSequence`. Any importer must take it from `@/lib/planner/cuisines`.

This is a pure move. `draftWeek` already calls `cuisineSequence(opts.cuisines, 7, opts.rng)` at `src/lib/planner/draft.ts:92` and that call site does not change.

- [ ] **Step 1: Move the sequence tests to the new file's ownership**

In `src/lib/planner/draft.test.ts`, delete the entire `describe('cuisineSequence', …)` block (lines 21-32, including the now-obsolete `"returns 'any' slots when no cuisines configured"` test — `'any'` no longer exists, and Task 1 already covers the replacement behaviour).

Then change the import on line 2 from:

```ts
import { cuisineSequence, draftWeek, vegetarianDays, type FavouriteRecipe } from './draft';
```

to:

```ts
import { draftWeek, vegetarianDays, type FavouriteRecipe } from './draft';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/planner/draft.test.ts`

Expected: PASS, actually — deleting tests does not break anything. The real failure comes next. Proceed to Step 3.

- [ ] **Step 3: Delete the old function and import the new one**

In `src/lib/planner/draft.ts`, delete lines 20-35 entirely (the `export function cuisineSequence(...) { … }` block and its preceding blank line).

Add to the imports at the top of the file, after the existing `import { scoreFavourite, … }` line:

```ts
import { cuisineSequence } from './cuisines';
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`

Expected: PASS. If any file still imports `cuisineSequence` from `./draft`, TypeScript will surface it here — fix by importing from `./cuisines`.

- [ ] **Step 5: Verify the type check is clean**

Run: `npx tsc --noEmit`

Expected: no output (success).

- [ ] **Step 6: Commit**

```bash
git add src/lib/planner/draft.ts src/lib/planner/draft.test.ts
git commit -m "$(cat <<'EOF'
refactor: draftWeek takes cuisineSequence from the cuisines module

Deletes the old sampling implementation and its 'any' fallback test.
draftWeek's call site is unchanged; the planner now never asks the model
for "any cuisine".

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Per-cuisine cap on AI results

**Files:**

- Modify: `src/lib/planner/draft.ts` (imports, `draftWeek` phases 1 and 2)
- Test: `src/lib/planner/draft.test.ts` (new tests in the `draftWeek` describe block)

**Interfaces:**

- Consumes: `effectiveCuisines` from Task 1.
- Produces: no signature change to `draftWeek`. Behaviour change only.

Two changes go together here, and the second is load-bearing:

1. **The cap.** `allowedPerCuisine = Math.ceil(7 / effectiveCuisines(opts.cuisines).length)`. A round-0 AI result whose self-reported `recipe.cuisine` is already at the cap is pushed back into `pending` exactly like a name collision. In the final round the cap is not applied — filling the night beats the variety rule.

2. **The round guard.** `src/lib/planner/draft.ts:154` currently reads `if (pending.length === before) break;` with the comment "no progress → AI unavailable". That is now wrong: a round where every result is cap-rejected also makes no progress, and breaking there would skip the retry that the cap depends on. Replace the condition with "every result was null", which is what "AI is unavailable" actually means.

- [ ] **Step 1: Write the failing tests**

Add these to `src/lib/planner/draft.test.ts` inside the existing `describe('draftWeek', …)` block, after the `'does not retry endlessly when AI is fully down'` test:

```ts
  it('rejects an over-cap cuisine in the first round and retries the slot', async () => {
    // 8 default cuisines (none configured) → cap of ceil(7/8) = 1 per cuisine.
    // The generator ignores the requested cuisine and always answers Mexican, so
    // every slot after the first is over cap and must be retried.
    const asked: string[] = [];
    let call = 0;
    await draftWeek({
      favourites: [], cuisines: [], recentNames: [],
      pinned: new Map(), vegetarianNights: 0, rng: () => 0,
      generate: async (req) => {
        asked.push(req.cuisine);
        return aiRecipe(`Mexican dish ${++call}`, 'mexican');
      },
    });
    // 7 slots in round 0; 6 of them are over cap and come back for round 1.
    expect(asked).toHaveLength(13);
  });

  it('relaxes the cap in the final round rather than leaving nights empty', async () => {
    let call = 0;
    const days = await draftWeek({
      favourites: [], cuisines: [], recentNames: [],
      pinned: new Map(), vegetarianNights: 0, rng: () => 0,
      generate: async () => aiRecipe(`Mexican dish ${++call}`, 'mexican'),
    });
    // A monotonous week beats an empty one: all 7 nights are filled.
    expect(days).toHaveLength(7);
    expect(days.every((d) => d.recipe.cuisine === 'mexican')).toBe(true);
  });

  it('keeps a cooperative generator inside the cap', async () => {
    let call = 0;
    const days = await draftWeek({
      favourites: [], cuisines: [], recentNames: [],
      pinned: new Map(), vegetarianNights: 0, rng: () => 0,
      generate: async (req) => aiRecipe(`Dish ${++call}`, req.cuisine),
    });
    expect(days).toHaveLength(7);
    const perCuisine = new Map<string, number>();
    for (const d of days) {
      const k = d.recipe.cuisine.toLowerCase();
      perCuisine.set(k, (perCuisine.get(k) ?? 0) + 1);
    }
    // Eight default cuisines over seven nights → every night a different one.
    expect([...perCuisine.values()].every((n) => n <= 1)).toBe(true);
  });

  it('counts pinned dinners toward the cap', async () => {
    const pinnedDinner = {
      day: 1, source: 'ai' as const, recipeId: 'r1', recipe: aiRecipe('Pinned tacos', 'mexican'),
    };
    const asked: string[] = [];
    await draftWeek({
      favourites: [], cuisines: [], recentNames: [],
      pinned: new Map([[1, pinnedDinner]]), vegetarianNights: 0, rng: () => 0,
      generate: async (req) => {
        asked.push(req.cuisine);
        return aiRecipe(`Mexican dish ${asked.length}`, 'mexican');
      },
    });
    // The pin already uses Mexican's single slot, so every one of the 6 AI slots
    // is over cap in round 0 and retried: 6 + 6 = 12 calls.
    expect(asked).toHaveLength(12);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/planner/draft.test.ts -t cap`

Expected: FAIL. Without a cap, `asked` has 7 entries, not 13 — the first test fails on that assertion.

- [ ] **Step 3: Add the cap to `draftWeek`**

In `src/lib/planner/draft.ts`, change the cuisines import to bring in both helpers:

```ts
import { cuisineSequence, effectiveCuisines } from './cuisines';
```

Immediately after the existing `const household = opts.equipment ?? [];` line, add the cuisine tally:

```ts
  // Variety guard: the generator is *asked* for a cuisine but self-reports whatever
  // it likes, so the sequence's balance guarantees nothing on its own. Cap each
  // cuisine at the same share the sequence promises, and count pinned and favourite
  // dinners toward it so the AI slots see an accurate picture.
  const cuisineNorm = (c: string) => c.trim().toLowerCase();
  const allowedPerCuisine = Math.ceil(7 / effectiveCuisines(opts.cuisines).length);
  const cuisineCount = new Map<string, number>();
  const countCuisine = (c: string) => {
    const k = cuisineNorm(c);
    cuisineCount.set(k, (cuisineCount.get(k) ?? 0) + 1);
  };
  const atCap = (c: string) => (cuisineCount.get(cuisineNorm(c)) ?? 0) >= allowedPerCuisine;
  for (const p of opts.pinned.values()) countCuisine(p.recipe.cuisine);
```

In phase 1, where a favourite is placed, add the tally. Change:

```ts
    if (wantFavourite && favMatch) {
      result[day] = { day, source: 'favourite', recipeId: favMatch.id, recipe: favMatch };
      used.add(favMatch.name.toLowerCase());
    } else {
```

to:

```ts
    if (wantFavourite && favMatch) {
      result[day] = { day, source: 'favourite', recipeId: favMatch.id, recipe: favMatch };
      used.add(favMatch.name.toLowerCase());
      countCuisine(favMatch.cuisine);
    } else {
```

In phase 2, change the acceptance test. Replace:

```ts
      if (ai && !used.has(ai.name.toLowerCase())) {
        used.add(ai.name.toLowerCase());
        result[slot.day] = { day: slot.day, source: 'ai', recipe: ai };
      } else {
        stillPending.push(slot);
      }
```

with:

```ts
      // The cap applies on the first pass only. On the last pass a monotonous
      // dinner beats an empty night, so anything that is not a duplicate is taken.
      const overCap = round === 0 && ai !== null && atCap(ai.cuisine);
      if (ai && !used.has(ai.name.toLowerCase()) && !overCap) {
        used.add(ai.name.toLowerCase());
        countCuisine(ai.cuisine);
        result[slot.day] = { day: slot.day, source: 'ai', recipe: ai };
      } else {
        stillPending.push(slot);
      }
```

Finally, in phase 3, tally the fallback favourite. Change:

```ts
    if (fav) {
      used.add(fav.name.toLowerCase());
      result[slot.day] = { day: slot.day, source: 'favourite', recipeId: fav.id, recipe: fav };
    }
```

to:

```ts
    if (fav) {
      used.add(fav.name.toLowerCase());
      countCuisine(fav.cuisine);
      result[slot.day] = { day: slot.day, source: 'favourite', recipeId: fav.id, recipe: fav };
    }
```

- [ ] **Step 4: Fix the round guard**

Still in `src/lib/planner/draft.ts` phase 2, the loop currently captures `before` and compares lengths. Delete the line:

```ts
    const before = pending.length;
```

and replace the guard at the end of the loop body:

```ts
    if (pending.length === before) break; // no progress → AI unavailable, don't retry
```

with:

```ts
    // Stop only when AI produced nothing at all — that means it is down, and
    // retrying would burn another round of timeouts. A round that produced
    // recipes but rejected them (duplicate names, over-cap cuisines) HAS made
    // progress worth retrying: the next round sees an updated avoid list.
    if (results.every((r) => r === null)) break;
```

- [ ] **Step 5: Run the full suite**

Run: `npm test`

Expected: PASS. The four new tests pass, and every pre-existing `draftWeek` test still passes — verified against the cap arithmetic: `['mexican','indian','italian']` gives a cap of 3 against balanced counts of 3/2/2, and `['indian','italian']` gives a cap of 4 against counts of 4/3.

- [ ] **Step 6: Commit**

```bash
git add src/lib/planner/draft.ts src/lib/planner/draft.test.ts
git commit -m "$(cat <<'EOF'
feat: cap each cuisine's share of the week

An AI result whose self-reported cuisine is already at its share is
retried rather than placed, so a generator that answers Mexican for every
slot no longer produces a Mexican week. The cap is dropped on the final
round: a monotonous dinner beats an empty night.

Also fixes the retry guard, which treated a round of rejected-but-real
results as "AI is down" and skipped the retry the cap depends on.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Soften the equipment gate

**Files:**

- Modify: `src/lib/macro/equipment.ts` (add `knownCapabilities` after `standoutTags`)
- Modify: `src/lib/ai/recipes.ts:80-100` (`generateRecipe`), `src/lib/ai/recipes.ts:118-130` (`estimateRecipe`)
- Test: `src/lib/macro/equipment.test.ts`, `src/lib/ai/recipes.test.ts`

**Interfaces:**

- Consumes: `CAPABILITIES`, `lacksEquipment` (both already exported from `src/lib/macro/equipment.ts`).
- Produces: `knownCapabilities(equipment: string[]): string[]`.

Why this matters most: `src/lib/ai/recipes.ts:88` currently bins the whole recipe when the model returns any equipment string outside the household's list. With kitchen equipment unticked on the live Family page, `req.equipment` is `[]`, so a model answering `["oven"]` instead of the required empty array loses a perfectly good dinner — twice — and the slot returns `null`. The fix distinguishes a model inventing vocabulary (strip it) from a recipe that genuinely needs gear the kitchen lacks (still reject).

- [ ] **Step 1: Write the failing test for the pure helper**

Add to `src/lib/macro/equipment.test.ts`:

```ts
describe('knownCapabilities', () => {
  it('keeps capabilities from the vocabulary', () => {
    expect(knownCapabilities(['steam', 'air-fry'])).toEqual(['steam', 'air-fry']);
  });
  it('drops words the model invented', () => {
    expect(knownCapabilities(['oven', 'hob', 'steam oven', 'saucepan'])).toEqual([]);
  });
  it('normalises case and whitespace', () => {
    expect(knownCapabilities([' Steam ', 'COMBI-STEAM'])).toEqual(['steam', 'combi-steam']);
  });
  it('dedupes', () => {
    expect(knownCapabilities(['steam', 'Steam'])).toEqual(['steam']);
  });
  it('handles an empty list', () => {
    expect(knownCapabilities([])).toEqual([]);
  });
});
```

Add `knownCapabilities` to that file's existing import from `./equipment`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/macro/equipment.test.ts`

Expected: FAIL — `knownCapabilities is not a function`.

- [ ] **Step 3: Implement the helper**

In `src/lib/macro/equipment.ts`, add directly after the `standoutTags` function:

```ts
/**
 * The recipe-equipment entries that are actually part of the capability
 * vocabulary, normalised and deduped. Models routinely answer with generic gear
 * ("oven", "hob", "saucepan") that no household ticks; those are noise, not a
 * cooking requirement, and screening a recipe out over them throws away a good
 * dinner. Mirrors standoutTags in shape.
 */
export function knownCapabilities(equipment: string[]): string[] {
  const known = new Set<string>(CAPABILITIES.map(norm));
  return [...new Set(equipment.map(norm))].filter((e) => known.has(e));
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/lib/macro/equipment.test.ts`

Expected: PASS.

- [ ] **Step 5: Write the failing tests for the gate**

Add to `src/lib/ai/recipes.test.ts`, inside the existing `describe('generateRecipe equipment re-screen', …)` block. First check the top of that file for the existing `req` / recipe helper names and reuse them; the block already builds requests with an `equipment` field.

```ts
  it('strips gear the model invented rather than binning the recipe', async () => {
    // Household has ticked nothing, and the model answers with generic kit.
    const gen = async () => ({ ...goodRecipe, equipment: ['oven', 'saucepan'] });
    const out = await generateRecipe({ ...req, equipment: [] }, gen);
    expect(out).not.toBeNull();
    expect(out!.equipment).toEqual([]);
  });

  it('returns the stripped, normalised equipment array', async () => {
    const gen = async () => ({ ...goodRecipe, equipment: [' Steam ', 'oven'] });
    const out = await generateRecipe({ ...req, equipment: ['steam'] }, gen);
    expect(out!.equipment).toEqual(['steam']);
  });
```

`goodRecipe` and `req` are the fixtures already defined at the top of that file (`src/lib/ai/recipes.test.ts:5-17`). `req` already carries `allergies: ['peanut']` and `equipment: ['steam', 'air-fry']`. Do not introduce new fixtures.

- [ ] **Step 6: Run them to verify they fail**

Run: `npx vitest run src/lib/ai/recipes.test.ts -t "strips gear"`

Expected: FAIL — `generateRecipe` returns `null`, because `lacksEquipment(['oven'], [])` reports `['oven']` as missing.

- [ ] **Step 7: Apply the strip in `generateRecipe`**

In `src/lib/ai/recipes.ts`, change the import on line 4 to add the helper:

```ts
import { CAPABILITIES, knownCapabilities, lacksEquipment, type Benefit } from '@/lib/macro/equipment';
```

Replace the body of the `generateRecipe` try block:

```ts
      const recipe = await gen(req);
      if (!energyConsistent(recipe.perServing)) continue;
      if (violatesAllergies(recipe.ingredients, req.allergies).length > 0) continue;
      if (lacksEquipment(recipe.equipment, req.equipment).length > 0) continue;
      return recipe;
```

with:

```ts
      const recipe = await gen(req);
      // Strip vocabulary the model invented before screening, so a stray "oven"
      // does not lose an otherwise good dinner. Real capabilities the kitchen
      // lacks are still a genuine blocker and still reject the recipe.
      const equipment = knownCapabilities(recipe.equipment);
      if (!energyConsistent(recipe.perServing)) continue;
      if (violatesAllergies(recipe.ingredients, req.allergies).length > 0) continue;
      if (lacksEquipment(equipment, req.equipment).length > 0) continue;
      return { ...recipe, equipment };
```

- [ ] **Step 8: Apply the same strip in `estimateRecipe`**

Still in `src/lib/ai/recipes.ts`, replace the `estimateRecipe` try block:

```ts
      const e = await est(input);
      if (energyConsistent(e.perServing)) return e;
```

with:

```ts
      const e = await est(input);
      if (energyConsistent(e.perServing)) return { ...e, equipment: knownCapabilities(e.equipment) };
```

- [ ] **Step 9: Run the full suite**

Run: `npm test`

Expected: PASS. The two pre-existing tests that assert a sous-vide recipe is rejected for a household lacking it must still pass — `sous-vide` is in `CAPABILITIES`, so it survives stripping and is caught by `lacksEquipment`, exactly as before. The integration test asserting persisted equipment equals `['steam']` also still passes, since `'steam'` normalises to itself.

- [ ] **Step 10: Commit**

```bash
git add src/lib/macro/equipment.ts src/lib/macro/equipment.test.ts src/lib/ai/recipes.ts src/lib/ai/recipes.test.ts
git commit -m "$(cat <<'EOF'
fix: strip invented equipment tags instead of binning the recipe

A model answering "oven" when the household has ticked no gear used to
lose the whole dinner and leave the night empty. Unknown vocabulary is
now stripped; capabilities the kitchen genuinely lacks still reject the
recipe, so appliance-aware screening is unchanged.

Recipes persist with the stripped, normalised array, which also makes
standout-gear badging on the Plan page more reliable.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Structured logger and AI failure reasons

**Files:**

- Create: `src/lib/log.ts`
- Test: `src/lib/log.test.ts`
- Modify: `src/lib/ai/recipes.ts` (`generateRecipe`)
- Test: `src/lib/ai/recipes.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `logEvent(evt: string, fields?: Record<string, unknown>): void` (writes `console.log`), `logWarn(evt: string, fields?: Record<string, unknown>): void` (writes `console.warn`). Both emit one line of JSON shaped `{"evt": "<name>", ...fields}`.

There is deliberately **no test-environment branch** in the logger. Tests that trigger failures spy on `console.warn`, which both silences the noise and lets them assert the reason code. A logger with a test-only silent path is a logger whose output is never verified.

Every failure event goes through `logWarn`. Only the `plan.summary` line in Task 7 uses `logEvent`. That split means `console.warn` carries exactly the things that went wrong.

- [ ] **Step 1: Write the failing logger tests**

Create `src/lib/log.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { logEvent, logWarn } from './log';

afterEach(() => vi.restoreAllMocks());

describe('logEvent', () => {
  it('writes one line of JSON to stdout with the event name first', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logEvent('plan.summary', { filled: 5, gaps: 2 });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(spy.mock.calls[0][0] as string)).toEqual({
      evt: 'plan.summary', filled: 5, gaps: 2,
    });
  });
  it('works with no fields', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logEvent('plan.started');
    expect(JSON.parse(spy.mock.calls[0][0] as string)).toEqual({ evt: 'plan.started' });
  });
});

describe('logWarn', () => {
  it('writes to stderr, not stdout', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    logWarn('recipe.timeout', { cuisine: 'thai', attempt: 0 });
    expect(log).not.toHaveBeenCalled();
    expect(JSON.parse(warn.mock.calls[0][0] as string)).toEqual({
      evt: 'recipe.timeout', cuisine: 'thai', attempt: 0,
    });
  });
  it('never throws on a value JSON cannot serialise', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => logWarn('recipe.ai_error', circular)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/log.test.ts`

Expected: FAIL — `Failed to resolve import "./log"`.

- [ ] **Step 3: Implement the logger**

Create `src/lib/log.ts`:

```ts
// One line of JSON per event, so Vercel's runtime logs stay greppable and a
// future log drain can parse them without a format change.
//
// There is no test-environment branch on purpose: tests spy on console, which
// both silences the output and lets them assert the reason code. A logger with
// a test-only silent path is a logger whose output is never verified.

type Fields = Record<string, unknown>;

function line(evt: string, fields: Fields): string {
  try {
    return JSON.stringify({ evt, ...fields });
  } catch {
    // A field that cannot be serialised must never take down a plan.
    return JSON.stringify({ evt, unserialisableFields: true });
  }
}

/** Routine, expected events. Goes to stdout. */
export function logEvent(evt: string, fields: Fields = {}): void {
  console.log(line(evt, fields));
}

/** Something went wrong and someone may need to look. Goes to stderr. */
export function logWarn(evt: string, fields: Fields = {}): void {
  console.warn(line(evt, fields));
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/log.test.ts`

Expected: PASS, 4 tests.

- [ ] **Step 5: Write the failing tests for AI failure reasons**

Add a new describe block at the end of `src/lib/ai/recipes.test.ts`. Reuse the file's existing fixtures for a valid recipe and a base request.

```ts
describe('generateRecipe failure logging', () => {
  afterEach(() => vi.restoreAllMocks());

  const reasons = (spy: ReturnType<typeof vi.spyOn>) =>
    spy.mock.calls.map((c) => JSON.parse(c[0] as string).evt);

  it('logs why an energy-inconsistent recipe was rejected', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bad = { ...goodRecipe, perServing: { kcal: 100, protein: 40, carbs: 55, fat: 20 } };
    await generateRecipe(req, async () => bad);
    expect(reasons(warn)).toContain('recipe.energy_inconsistent');
    expect(reasons(warn)).toContain('recipe.failed');
  });

  it('logs an allergy violation with the allergens', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await generateRecipe(
      req,
      async () => ({
        ...goodRecipe,
        ingredients: [{ name: 'peanut butter', quantity: 1, unit: 'tbsp', section: 'pantry' as const }],
      }),
    );
    const call = warn.mock.calls
      .map((c) => JSON.parse(c[0] as string))
      .find((e) => e.evt === 'recipe.allergy_violation');
    expect(call.allergens).toEqual(['peanut']);
  });

  it('logs unavailable equipment with what was missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await generateRecipe(
      { ...req, equipment: ['steam'] },
      async () => ({ ...goodRecipe, equipment: ['sous-vide'] }),
    );
    const call = warn.mock.calls
      .map((c) => JSON.parse(c[0] as string))
      .find((e) => e.evt === 'recipe.equipment_unavailable');
    expect(call.missing).toEqual(['sous-vide']);
  });

  it('distinguishes a timeout from any other thrown error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await generateRecipe(req, async () => {
      const e = new Error('aborted');
      e.name = 'TimeoutError';
      throw e;
    });
    expect(reasons(warn)).toContain('recipe.timeout');
    expect(reasons(warn)).not.toContain('recipe.ai_error');
  });

  it('logs a non-timeout throw as an ai_error carrying the message', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await generateRecipe(req, async () => { throw new Error('schema mismatch'); });
    const call = warn.mock.calls
      .map((c) => JSON.parse(c[0] as string))
      .find((e) => e.evt === 'recipe.ai_error');
    expect(call.message).toBe('schema mismatch');
  });

  it('says nothing when the recipe is fine', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await generateRecipe(req, async () => goodRecipe);
    expect(warn).not.toHaveBeenCalled();
  });
});
```

Make sure `afterEach` and `vi` are in the file's `vitest` import.

- [ ] **Step 6: Run to verify failure**

Run: `npx vitest run src/lib/ai/recipes.test.ts -t "failure logging"`

Expected: FAIL — nothing is logged, so every `toContain` assertion fails.

- [ ] **Step 7: Add the logging**

In `src/lib/ai/recipes.ts`, add the import:

```ts
import { logWarn } from '@/lib/log';
```

Replace the whole `generateRecipe` loop body with:

```ts
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const recipe = await gen(req);
      // Strip vocabulary the model invented before screening, so a stray "oven"
      // does not lose an otherwise good dinner. Real capabilities the kitchen
      // lacks are still a genuine blocker and still reject the recipe.
      const equipment = knownCapabilities(recipe.equipment);

      if (!energyConsistent(recipe.perServing)) {
        const m = recipe.perServing;
        logWarn('recipe.energy_inconsistent', {
          cuisine: req.cuisine, attempt,
          kcal: m.kcal, computed: 4 * m.protein + 4 * m.carbs + 9 * m.fat,
        });
        continue;
      }

      const allergens = violatesAllergies(recipe.ingredients, req.allergies);
      if (allergens.length > 0) {
        logWarn('recipe.allergy_violation', { cuisine: req.cuisine, attempt, allergens });
        continue;
      }

      const missing = lacksEquipment(equipment, req.equipment);
      if (missing.length > 0) {
        logWarn('recipe.equipment_unavailable', { cuisine: req.cuisine, attempt, missing });
        continue;
      }

      return { ...recipe, equipment };
    } catch (err) {
      // A timeout and a schema error call for different responses, so they are
      // never collapsed into one reason code.
      const name = err instanceof Error ? err.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        logWarn('recipe.timeout', { cuisine: req.cuisine, attempt });
      } else {
        logWarn('recipe.ai_error', {
          cuisine: req.cuisine, attempt,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  logWarn('recipe.failed', { cuisine: req.cuisine, attempts: 2 });
  return null;
```

Note this supersedes the Task 4 edit to the same block — the equipment strip and its comment are preserved above.

- [ ] **Step 8: Run the full suite**

Run: `npm test`

Expected: PASS. Pre-existing tests in `recipes.test.ts` that drive failures will now write to `console.warn`; that is noise, not failure. If the noise is distracting, that is a signal those tests should spy too — add `vi.spyOn(console, 'warn').mockImplementation(() => {})` to them, but do not add a silencing branch to `log.ts`.

- [ ] **Step 9: Commit**

```bash
git add src/lib/log.ts src/lib/log.test.ts src/lib/ai/recipes.ts src/lib/ai/recipes.test.ts
git commit -m "$(cat <<'EOF'
feat: log why a recipe generation attempt was rejected

Every rejection path in generateRecipe was a silent continue or a bare
catch, so a missing dinner could not be attributed to a timeout, a rate
limit, an energy-check failure or an equipment mismatch. Each now emits a
JSON line through the new structured logger, with timeouts distinguished
from other throws.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Slot events from `draftWeek`

**Files:**

- Modify: `src/lib/planner/draft.ts` (type export, `draftWeek` options and phases 2-3)
- Test: `src/lib/planner/draft.test.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces:

  ```ts
  export type DraftEvent =
    | { type: 'ai-collision'; day: number; reason: 'duplicate-name' | 'cuisine-cap'; name: string }
    | { type: 'ai-empty'; day: number }
    | { type: 'fallback-favourite'; day: number; name: string }
    | { type: 'gap'; day: number };
  ```

  and a new **optional** field on `draftWeek`'s options object: `onEvent?: (event: DraftEvent) => void`.

`draftWeek` lives in the pure layer and must not log. The callback is the same injection idiom as the existing `generate` parameter, and being optional it leaves every current caller and test untouched.

- [ ] **Step 1: Write the failing tests**

Add a new describe block at the end of `src/lib/planner/draft.test.ts`:

```ts
describe('draftWeek slot events', () => {
  const collect = () => {
    const events: DraftEvent[] = [];
    return { events, onEvent: (e: DraftEvent) => events.push(e) };
  };

  it('reports a duplicate name collision', async () => {
    const { events, onEvent } = collect();
    await draftWeek({
      favourites: [], cuisines: ['italian'], recentNames: [],
      pinned: new Map(), vegetarianNights: 0, rng: () => 0, onEvent,
      generate: async () => aiRecipe('Same dish', 'italian'),
    });
    const dupes = events.filter((e) => e.type === 'ai-collision' && e.reason === 'duplicate-name');
    expect(dupes.length).toBeGreaterThan(0);
  });

  it('reports a cuisine-cap collision', async () => {
    const { events, onEvent } = collect();
    let n = 0;
    await draftWeek({
      favourites: [], cuisines: [], recentNames: [],
      pinned: new Map(), vegetarianNights: 0, rng: () => 0, onEvent,
      generate: async () => aiRecipe(`Mexican dish ${++n}`, 'mexican'),
    });
    const capped = events.filter((e) => e.type === 'ai-collision' && e.reason === 'cuisine-cap');
    expect(capped).toHaveLength(6); // 8 default cuisines → cap 1; 6 of 7 slots over cap
  });

  it('reports an empty AI result', async () => {
    const { events, onEvent } = collect();
    await draftWeek({
      favourites: [], cuisines: ['italian'], recentNames: [],
      pinned: new Map(), vegetarianNights: 0, rng: () => 0, onEvent,
      generate: async () => null,
    });
    expect(events.filter((e) => e.type === 'ai-empty')).toHaveLength(7);
  });

  it('reports a favourite used to backfill a failed AI slot', async () => {
    const { events, onEvent } = collect();
    // The favourite's cuisine deliberately does NOT match the configured one, so
    // phase 1's cuisine-matched pick cannot consume it and it is still on the
    // shelf for phase 3's cuisine-blind fallback. A matching favourite would be
    // placed in phase 1 and never reach the backfill path at all.
    await draftWeek({
      favourites: [fav('Thai green curry', 'thai')], cuisines: ['italian'], recentNames: [],
      pinned: new Map(), vegetarianNights: 0, rng: () => 0, onEvent,
      generate: async () => null,
    });
    const backfills = events.filter((e) => e.type === 'fallback-favourite');
    expect(backfills).toHaveLength(1);
    expect(backfills[0]).toMatchObject({ type: 'fallback-favourite', name: 'Thai green curry' });
    // One favourite covers one night; the other six have nothing left.
    expect(events.filter((e) => e.type === 'gap')).toHaveLength(6);
  });

  it('reports a night nothing could fill', async () => {
    const { events, onEvent } = collect();
    await draftWeek({
      favourites: [], cuisines: ['italian'], recentNames: [],
      pinned: new Map(), vegetarianNights: 0, rng: () => 0, onEvent,
      generate: async () => null,
    });
    expect(events.filter((e) => e.type === 'gap')).toHaveLength(7);
  });

  it('works without a callback', async () => {
    const days = await draftWeek({
      favourites: [], cuisines: ['italian'], recentNames: [],
      pinned: new Map(), vegetarianNights: 0, rng: () => 0,
      generate: async (req) => aiRecipe(`AI ${req.day}`, req.cuisine),
    });
    expect(days).toHaveLength(7);
  });
});
```

Add `type DraftEvent` to the file's import from `./draft`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/planner/draft.test.ts -t "slot events"`

Expected: FAIL — `DraftEvent` is not exported.

- [ ] **Step 3: Add the type and the option**

In `src/lib/planner/draft.ts`, add after the `DraftGenerateRequest` type:

```ts
/**
 * What happened to one night's slot. draftWeek is pure and must not log, so it
 * reports through an injected callback the way it already takes an injected
 * generator; the service layer decides what to do with these.
 */
export type DraftEvent =
  | { type: 'ai-collision'; day: number; reason: 'duplicate-name' | 'cuisine-cap'; name: string }
  | { type: 'ai-empty'; day: number }
  | { type: 'fallback-favourite'; day: number; name: string }
  | { type: 'gap'; day: number };
```

Add the option to `draftWeek`'s parameter type, after `generate`:

```ts
  onEvent?: (event: DraftEvent) => void;
```

And immediately inside the function body, after `const household = …`:

```ts
  const emit = opts.onEvent ?? (() => {});
```

- [ ] **Step 4: Emit from phase 2**

Replace the acceptance branch written in Task 3 with the emitting version:

```ts
      const overCap = round === 0 && ai !== null && atCap(ai.cuisine);
      if (ai && !used.has(ai.name.toLowerCase()) && !overCap) {
        used.add(ai.name.toLowerCase());
        countCuisine(ai.cuisine);
        result[slot.day] = { day: slot.day, source: 'ai', recipe: ai };
      } else {
        if (ai === null) {
          emit({ type: 'ai-empty', day: slot.day });
        } else {
          emit({
            type: 'ai-collision', day: slot.day, name: ai.name,
            reason: overCap ? 'cuisine-cap' : 'duplicate-name',
          });
        }
        stillPending.push(slot);
      }
```

- [ ] **Step 5: Emit from phase 3**

Replace the phase 3 fill block with:

```ts
    if (fav) {
      used.add(fav.name.toLowerCase());
      countCuisine(fav.cuisine);
      result[slot.day] = { day: slot.day, source: 'favourite', recipeId: fav.id, recipe: fav };
      emit({ type: 'fallback-favourite', day: slot.day, name: fav.name });
    } else {
      emit({ type: 'gap', day: slot.day });
    }
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/planner/draft.ts src/lib/planner/draft.test.ts
git commit -m "$(cat <<'EOF'
feat: draftWeek reports per-slot outcomes through a callback

Collisions, empty AI results, favourite backfills and unfilled nights are
now observable. The callback is optional and injected, so the planner
stays pure and every existing caller is unaffected.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `planWeek` reports gaps and logs the summary

**Files:**

- Modify: `src/lib/services/planning.ts:84-140` (`planWeek`)
- Test: `src/lib/services/planning.test.ts`

**Interfaces:**

- Consumes: `DraftEvent` (Task 6), `logEvent` / `logWarn` (Task 5).
- Produces: `planWeek` returns `Promise<{ aiDegraded: boolean; filled: number; gaps: number }>` — was `Promise<{ aiDegraded: boolean }>`.

`filled` counts every planned night including pinned ones; `gaps` is `7 - filled`. `aiDegraded` keeps its exact current meaning and is independent: AI can be fully down with no gaps if favourites cover the week, and up but repetitive with several gaps.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/services/planning.test.ts`, in the describe block that covers `planWeek`:

```ts
  it('reports no gaps when every night is filled', async () => {
    const db = await createTestDb();
    await db.insert(people).values(adult);
    await db.insert(settings).values({ id: 1, cuisines: ['italian'], equipment: [] });

    const { filled, gaps } = await planWeek(db, '2026-06-29', makeAi([]));

    expect(filled).toBe(7);
    expect(gaps).toBe(0);
  });

  it('reports the gaps left when AI fills nothing and there are no favourites', async () => {
    const db = await createTestDb();
    await db.insert(people).values(adult);
    await db.insert(settings).values({ id: 1, cuisines: ['italian'], equipment: [] });

    const { aiDegraded, filled, gaps } = await planWeek(db, '2026-06-29', async () => {
      throw new Error('gateway down');
    });

    expect(aiDegraded).toBe(true);
    expect(filled).toBe(0);
    expect(gaps).toBe(7);
  });

  it('counts favourite backfills as filled, so a degraded week can still have no gaps', async () => {
    const db = await createTestDb();
    await db.insert(people).values(adult);
    await db.insert(settings).values({ id: 1, cuisines: ['italian'], equipment: [] });
    for (let i = 0; i < 7; i++) {
      await db.insert(recipes).values({
        name: `Favourite ${i}`, cuisine: 'italian', method: '', servings: 4,
        perServing: { kcal: 600, protein: 40, carbs: 55, fat: 20 },
        tags: [], equipment: [], source: 'family',
        ingredients: [{ name: 'x', quantity: 1, unit: 'pcs', section: 'other' }],
      });
    }

    const { aiDegraded, filled, gaps } = await planWeek(db, '2026-06-29', async () => {
      throw new Error('gateway down');
    });

    expect(aiDegraded).toBe(true);
    expect(filled).toBe(7);
    expect(gaps).toBe(0);
  });

  it('logs one summary line carrying the cuisine spread', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const db = await createTestDb();
    await db.insert(people).values(adult);
    await db.insert(settings).values({ id: 1, cuisines: [], equipment: [] });

    await planWeek(db, '2026-06-29', makeAi([]));

    const summary = log.mock.calls
      .map((c) => JSON.parse(c[0] as string))
      .find((e) => e.evt === 'plan.summary');
    expect(summary).toMatchObject({ weekStart: '2026-06-29', filled: 7, gaps: 0 });
    // Eight default cuisines over seven nights → seven distinct, one night each.
    expect(Object.keys(summary.cuisines)).toHaveLength(7);
    vi.restoreAllMocks();
  });
```

Add `vi` to the file's `vitest` import if it is not already there.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/services/planning.test.ts -t gaps`

Expected: FAIL — `filled` and `gaps` are `undefined`.

- [ ] **Step 3: Implement**

In `src/lib/services/planning.ts`, extend the draft import:

```ts
import { draftWeek, type DraftDinner, type DraftEvent, type DraftGenerateRequest } from '@/lib/planner/draft';
```

and add:

```ts
import { logEvent, logWarn } from '@/lib/log';
```

Change the signature:

```ts
export async function planWeek(
  db: Db,
  weekStart: string,
  gen: Generator = aiGenerator,
): Promise<{ aiDegraded: boolean; filled: number; gaps: number }> {
```

Replace the `draftWeek` call with one that forwards events:

```ts
  const days = await draftWeek({
    favourites: ctx.favourites, cuisines: ctx.config.cuisines,
    recentNames: recent.map((r) => r.name),
    pinned, vegetarianNights: ctx.config.vegetarianNights,
    equipment: ctx.config.equipment, generate,
    onEvent: (e: DraftEvent) => logWarn(`plan.${e.type}`, { weekStart, ...e }),
  });
```

Then replace the return statement and everything from the persist loop down with:

```ts
  for (const dinner of days) {
    if (pinned.has(dinner.day)) continue; // already persisted
    await persistDinner(db, plan.id, dinner, ctx.targets);
  }
  await pruneOrphanAiRecipes(db);
  // a re-plan invalidates any existing list
  await db.delete(shoppingLists).where(eq(shoppingLists.weekPlanId, plan.id));

  const cuisines: Record<string, number> = {};
  for (const d of days) {
    const k = d.recipe.cuisine.trim().toLowerCase();
    cuisines[k] = (cuisines[k] ?? 0) + 1;
  }
  const filled = days.length;
  const gaps = 7 - filled;
  // The one line worth grepping: says in a single record whether a short week
  // came from AI failures, cap rejections, or an exhausted favourites library.
  logEvent('plan.summary', {
    weekStart, requested: aiRequested, succeeded: aiSucceeded, filled, gaps, cuisines,
  });

  return { aiDegraded: aiRequested > 0 && aiSucceeded === 0, filled, gaps };
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`

Expected: PASS. Existing callers destructure only `aiDegraded`, so the widened return type is backwards compatible.

- [ ] **Step 5: Verify the type check**

Run: `npx tsc --noEmit`

Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/lib/services/planning.ts src/lib/services/planning.test.ts
git commit -m "$(cat <<'EOF'
feat: planWeek reports filled nights and logs a plan summary

A week with three of seven nights filled used to report success. planWeek
now returns { aiDegraded, filled, gaps }, forwards draftWeek's slot events
to the logger, and emits one plan.summary line with the cuisine spread.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Surface a short week on the Plan page

**Files:**

- Modify: `src/app/actions/plan.ts:19-26` (`planMyWeek`)
- Modify: `src/app/(app)/page.tsx:100-107` (searchParams type and destructure), `src/app/(app)/page.tsx:155-159` (the `planned` banner)

**Interfaces:**

- Consumes: `planWeek`'s `{ aiDegraded, filled, gaps }` from Task 7.
- Produces: no new exports. A `gaps` search param on `/`.

The amber notice **replaces** the green one rather than stacking: a green "Week planned" above an amber "two nights missing" is contradictory. It keeps the shopping-list link, because a short week's list is still worth building. The `degraded` banner is separate and unchanged; both can legitimately show at once when AI is down and favourites cannot cover the week.

- [ ] **Step 1: Pass the count through the action**

In `src/app/actions/plan.ts`, replace the body of `planMyWeek`:

```ts
export async function planMyWeek(formData: FormData) {
  const { weekStart, isNext } = weekFrom(formData);
  const { aiDegraded } = await planWeek(getDb(), weekStart);
  revalidatePath('/');
  const wk = isNext ? '&week=next' : '';
  redirect(aiDegraded ? `/?degraded=1${wk}` : `/?planned=1${wk}`);
}
```

with:

```ts
export async function planMyWeek(formData: FormData) {
  const { weekStart, isNext } = weekFrom(formData);
  const { aiDegraded, gaps } = await planWeek(getDb(), weekStart);
  revalidatePath('/');
  const wk = isNext ? '&week=next' : '';
  const shortfall = gaps > 0 ? `&gaps=${gaps}` : '';
  redirect(aiDegraded ? `/?degraded=1${wk}${shortfall}` : `/?planned=1${wk}${shortfall}`);
}
```

- [ ] **Step 2: Accept the param on the page**

In `src/app/(app)/page.tsx`, add `gaps?: string;` to the `searchParams` type (the object at lines 102-106), and add `gaps` to the destructure on line 107.

Immediately after, add the parse:

```ts
  const missing = Number(gaps) > 0 ? Number(gaps) : 0;
```

- [ ] **Step 3: Swap the banner**

Replace the `{planned && (…)}` block:

```tsx
      {planned && (
        <p className="card border-bottle bg-bottle-soft p-3 text-sm">
          Week planned — <Link className="font-medium underline underline-offset-3" href={isNext ? '/shopping?week=next' : '/shopping'}>build your shopping list →</Link>
        </p>
      )}
```

with:

```tsx
      {planned && missing === 0 && (
        <p className="card border-bottle bg-bottle-soft p-3 text-sm">
          Week planned — <Link className="font-medium underline underline-offset-3" href={isNext ? '/shopping?week=next' : '/shopping'}>build your shopping list →</Link>
        </p>
      )}

      {missing > 0 && (
        <p className="card border-dijon bg-dijon-soft p-3 text-sm">
          Filled {7 - missing} of 7 nights — {missing} couldn&apos;t be generated. Use the swap
          buttons on those days to fill them.{' '}
          <Link className="font-medium underline underline-offset-3" href={isNext ? '/shopping?week=next' : '/shopping'}>Build your shopping list →</Link>
        </p>
      )}
```

- [ ] **Step 4: Verify the build and types**

Run: `npm run build && npx tsc --noEmit`

Expected: build succeeds, no type errors.

- [ ] **Step 5: Run the full suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "src/app/actions/plan.ts" "src/app/(app)/page.tsx"
git commit -m "$(cat <<'EOF'
feat: tell the user when the planner left nights empty

A short week used to redirect to ?planned=1 and read as a success. The
green banner is now replaced by an amber one naming the shortfall and
pointing at the per-day swap controls.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Documentation and final verification

**Files:**

- Modify: `docs/roadmap.md`
- Modify: `CLAUDE.md` (the Architecture section's AI paragraph)

**Interfaces:**

- Consumes: everything above.
- Produces: no code.

- [ ] **Step 1: Record the work and the deferred items in the roadmap**

In `docs/roadmap.md`, add to the "Done since this roadmap was written" list, following the numbering already in the file:

```markdown
8. ~~**Planner variety and gap reporting**~~ ✅ `cuisineSequence` no longer
   returns `'any'` when no cuisines are configured — a new
   `src/lib/planner/cuisines.ts` deals balanced, non-adjacent sequences from
   the household's list or an eight-entry default rotation. `draftWeek` caps
   each cuisine at `ceil(7 / cuisines)` on the first pass and drops the cap on
   the last so the cap never creates gaps. The equipment re-screen now strips
   model-invented tags instead of binning the recipe, which was losing whole
   dinners whenever kitchen equipment was unticked. `planWeek` returns
   `{ aiDegraded, filled, gaps }` and the Plan page reports a short week.
   Failure logging added throughout the AI layer (partially covers item 11).
   Spec `2026-08-19-planner-variety-and-gaps-design.md`, plan
   `2026-08-20-planner-variety-and-gaps.md`.
```

Renumber the existing "Next" and "Later" items if the numbering collides, and add these three to "Later / opportunistic":

```markdown
- **`swapDay` cuisine choice** — plain `'ai'` mode uses
  `ctx.config.cuisines[0] ?? 'any'`, always the first configured cuisine, so
  swapping away from a Mexican dinner can hand back another one. Should use
  the day's cuisine from the rotation. Deliberately out of scope of the
  2026-08-19 spec, which covered the drafting path only.
- **Near-duplicate recipe names** — dedupe is exact-name only, so "Chicken
  Tacos" and "Beef Tacos" both stand. The cuisine cap covers most of the
  observed symptom; fuzzy matching risks false rejections.
- **Retry backoff in `generateRecipe`** — retries fire immediately, so a rate
  limit on a seven-call burst likely hits again. The new `recipe.ai_error`
  logging will show whether this happens in practice before anything is built.
```

- [ ] **Step 2: Update the CLAUDE.md AI paragraph**

In `CLAUDE.md`, the Architecture section currently ends its AI paragraph with:

```markdown
Every AI recipe is validated in code (kcal ≈ 4·protein + 4·carbs + 9·fat ±15%, allergy re-screen) and silently regenerated once on failure; AI being down must never block planning — fall back to favourites-only and surface a notice.
```

Replace "silently regenerated once on failure" and extend, so it reads:

```markdown
Every AI recipe is validated in code (kcal ≈ 4·protein + 4·carbs + 9·fat ±15%, allergy re-screen, equipment re-screen) and regenerated once on failure, with the reason logged via `src/lib/log.ts`; AI being down must never block planning — fall back to favourites-only and surface a notice. Equipment tags outside the `CAPABILITIES` vocabulary are stripped rather than rejected. Cuisines come from `src/lib/planner/cuisines.ts`, which never yields a placeholder — the planner must never ask the model for "any cuisine".
```

- [ ] **Step 3: Full verification**

Run each and confirm before claiming anything is done:

```bash
npm test
npm run build
npx tsc --noEmit
```

Expected: suite green with the new tests (baseline was 196 in 22 files; this plan adds roughly 32 across 2 new files), build succeeds, no type errors.

- [ ] **Step 4: Confirm no `console.*` leaked into the pure layers**

Run:

```bash
grep -rn "console\." src/lib/macro src/lib/planner
```

Expected: no output. Logging belongs to the service layer; `draftWeek` reports through `onEvent`.

- [ ] **Step 5: Commit**

```bash
git add docs/roadmap.md CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: planner variety and gap reporting shipped

Records the feature in the roadmap along with the three deliberately
deferred follow-ups, and updates CLAUDE.md's AI paragraph for the
equipment strip, the failure logging and the cuisines module.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Open the PR**

```bash
git push -u origin feature/planner-variety-and-gaps
gh pr create --base master --title "Planner variety and gap reporting" --body "$(cat <<'EOF'
## What

The recipe finder was leaving nights empty and leaning heavily Mexican.
Both trace to `cuisineSequence` returning `'any'` when no cuisines are
configured, which made all seven AI prompts identical.

- New `src/lib/planner/cuisines.ts`: balanced, non-adjacent sequences from
  the household's cuisines or an eight-entry default rotation. Never `'any'`.
- `draftWeek` caps each cuisine at `ceil(7 / cuisines)` on the first pass,
  and drops the cap on the last so the cap can never create a gap.
- The equipment re-screen strips model-invented tags (`"oven"`) instead of
  binning the recipe. With kitchen equipment unticked this was silently
  losing whole dinners.
- `planWeek` returns `{ aiDegraded, filled, gaps }`; the Plan page shows an
  amber notice naming the shortfall instead of a green success banner.
- Structured failure logging throughout the AI layer, plus one
  `plan.summary` line per plan.

## Deferred

`swapDay`'s `cuisines[0]`, near-duplicate name detection, and retry
backoff — all recorded in `docs/roadmap.md`.

Spec: `docs/superpowers/specs/2026-08-19-planner-variety-and-gaps-design.md`
Plan: `docs/superpowers/plans/2026-08-20-planner-variety-and-gaps.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
