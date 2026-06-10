# Family Dinner Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A web app that drafts a week of family dinners (favourites + AI suggestions) hitting calculated macro targets, with per-person portion guidance and a store-section-grouped shopping list.

**Architecture:** Single Next.js (App Router) app on Vercel. Neon Postgres via Drizzle ORM. AI recipe generation through Vercel AI Gateway (`generateObject` + Zod, injectable for tests). All arithmetic lives in a pure, unit-tested TypeScript macro engine; AI only generates recipe content. Single shared household password auth.

**Tech Stack:** Next.js 16 (App Router, TypeScript, Tailwind), Drizzle ORM, `@neondatabase/serverless`, AI SDK v6 (`ai` package, gateway model strings), Zod, Vitest, PGlite (integration tests).

**Spec:** `docs/superpowers/specs/2026-06-10-dinner-planner-design.md`

---

## File Structure

```
src/
  lib/
    macro/
      types.ts            # MacroSet, PersonProfile, Ingredient, RecipeData, StoreSection
      targets.ts          # BMR, daily targets, dinner targets        (+ targets.test.ts)
      portions.ts         # per-person portion solver                 (+ portions.test.ts)
      tally.ts            # weekly macro tally vs targets             (+ tally.test.ts)
      aggregate.ts        # ingredient aggregation, staples           (+ aggregate.test.ts)
      validate.ts         # AI sanity checks (energy, allergies)      (+ validate.test.ts)
    ai/
      schema.ts           # Zod schemas for AI recipe + estimate output
      recipes.ts          # generateRecipe / estimateRecipe (injectable) (+ recipes.test.ts)
    planner/
      draft.ts            # cuisine sequence + week drafting          (+ draft.test.ts)
    db/
      schema.ts           # Drizzle tables
      index.ts            # Neon client + Db type
    services/
      dates.ts            # currentWeekStart                          (+ dates.test.ts)
      ingredients.ts      # parse ingredient text lines               (+ ingredients.test.ts)
      planning.ts         # planWeek, swapDay, togglePin, getWeek
      shopping.ts         # staples check, build/edit list
    auth.ts               # session token helpers                     (+ auth.test.ts)
  middleware.ts           # redirect to /login without session cookie
  app/
    login/page.tsx        # password form
    actions/auth.ts       # login action
    (app)/
      layout.tsx          # nav shell (Plan / Shopping / Recipes / Family)
      page.tsx            # Plan: week-at-a-glance grid
      shopping/page.tsx   # Shopping list + staples check
      recipes/page.tsx    # Favourites library + AI macro estimate
      family/page.tsx     # Profiles, settings, staples
    actions/
      family.ts  recipes.ts  plan.ts  shopping.ts
tests/
  integration/flows.test.ts   # PGlite: plan week → swap → shopping list
drizzle/                  # generated SQL migrations
drizzle.config.ts  vitest.config.ts
```

Day indexing convention: `0 = Monday … 6 = Sunday`. Week identified by `weekStart` (Monday, `YYYY-MM-DD`).

---

### Task 1: Project scaffold, test runner, environment

**Files:**
- Create: Next.js scaffold (via `create-next-app`), `vitest.config.ts`, `.env.local`, `drizzle.config.ts`
- Modify: `package.json` (scripts), `.gitignore`

- [ ] **Step 1: Scaffold Next.js into the existing directory**

`create-next-app` rejects unknown dotfiles; move `.superpowers` aside first.

```bash
cd /Users/adriancorsini/Development/alpha
[ -d .superpowers ] && mv .superpowers /tmp/alpha-superpowers
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --yes
[ -d /tmp/alpha-superpowers ] && mv /tmp/alpha-superpowers .superpowers
```

Expected: scaffold completes; `src/app/page.tsx` exists.

- [ ] **Step 2: Install dependencies**

```bash
npm install drizzle-orm @neondatabase/serverless zod ai
npm install -D vitest drizzle-kit @electric-sql/pglite dotenv
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Add scripts to `package.json`**

Add to the `"scripts"` block (keep existing entries):

```json
"test": "vitest run",
"test:watch": "vitest",
"db:generate": "drizzle-kit generate",
"db:push": "drizzle-kit push"
```

- [ ] **Step 5: Create `drizzle.config.ts`**

```ts
import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

- [ ] **Step 6: Create `.env.local` (manual values needed)**

```bash
cat > .env.local <<'EOF'
DATABASE_URL=postgres://...        # Neon connection string — see note below
HOUSEHOLD_PASSWORD=change-me
AUTH_SECRET=generate-a-long-random-string
# AI_MODEL=anthropic/claude-haiku-4.5   # optional override
EOF
```

> **Manual prerequisite (cannot be automated without credentials):** create a Neon Postgres database — either via Vercel Marketplace (`vercel link` then add the Neon integration in the dashboard, then `vercel env pull .env.local`, which also provisions `VERCEL_OIDC_TOKEN` for AI Gateway) or directly at neon.tech. Paste the connection string into `DATABASE_URL`. Set `AUTH_SECRET` with `openssl rand -hex 32`. If running without Vercel OIDC locally, set `AI_GATEWAY_API_KEY` instead.

Ensure `.gitignore` contains `.env*` and `.superpowers/` (it already does from the design phase — verify after scaffold overwrote it):

```bash
grep -q '.superpowers/' .gitignore || printf '.superpowers/\n' >> .gitignore
grep -q '.env' .gitignore || printf '.env*\n' >> .gitignore
```

- [ ] **Step 7: Verify the toolchain**

```bash
npm test
```

Expected: Vitest runs, reports "No test files found" (exit 0 with `--passWithNoTests`? — if it exits 1, that's fine at this stage; tests arrive in Task 2).

```bash
npm run dev -- --port 3100 &
sleep 5 && curl -s -o /dev/null -w "%{http_code}" http://localhost:3100
kill %1
```

Expected: `200`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app with vitest and drizzle tooling"
```

---

### Task 2: Macro types + daily/dinner target calculation

**Files:**
- Create: `src/lib/macro/types.ts`, `src/lib/macro/targets.ts`
- Test: `src/lib/macro/targets.test.ts`

- [ ] **Step 1: Create the shared types (no test needed — types only)**

`src/lib/macro/types.ts`:

```ts
export type MacroSet = { kcal: number; protein: number; carbs: number; fat: number };

export type Sex = 'male' | 'female';
export type Goal = 'lose' | 'maintain' | 'gain';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
export type StoreSection = 'produce' | 'meat_fish' | 'dairy' | 'pantry' | 'frozen' | 'other';

export type PersonProfile = {
  id: string;
  name: string;
  age: number;
  sex: Sex;
  weightKg: number;
  heightCm: number;
  activity: ActivityLevel;
  goal: Goal;
  allergies: string[];
  dislikes: string[];
};

export type Ingredient = {
  name: string;
  quantity: number;
  unit: string;
  section: StoreSection;
};

export type RecipeData = {
  name: string;
  cuisine: string;
  method: string;
  servings: number;
  perServing: MacroSet;
  tags: string[];
  ingredients: Ingredient[];
};
```

- [ ] **Step 2: Write the failing tests**

`src/lib/macro/targets.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { bmr, dailyTargets, dinnerTargets } from './targets';
import type { PersonProfile } from './types';

const dad: PersonProfile = {
  id: '1', name: 'Dad', age: 40, sex: 'male', weightKg: 80, heightCm: 180,
  activity: 'moderate', goal: 'maintain', allergies: [], dislikes: [],
};

describe('bmr (Mifflin-St Jeor)', () => {
  it('computes male BMR', () => {
    // 10*80 + 6.25*180 - 5*40 + 5 = 1730
    expect(bmr(dad)).toBeCloseTo(1730);
  });
  it('computes female BMR', () => {
    // 10*65 + 6.25*165 - 5*38 - 161 = 1330.25
    expect(bmr({ ...dad, sex: 'female', weightKg: 65, heightCm: 165, age: 38 })).toBeCloseTo(1330.25);
  });
});

describe('dailyTargets', () => {
  it('applies activity multiplier and macro split', () => {
    const t = dailyTargets(dad);
    expect(t.kcal).toBeCloseTo(1730 * 1.55); // 2681.5
    expect(t.protein).toBeCloseTo(144); // 1.8 g/kg
    expect(t.fat).toBeCloseTo((2681.5 * 0.25) / 9, 1);
    expect(t.carbs).toBeCloseTo((2681.5 - 144 * 4 - t.fat * 9) / 4, 1);
  });
  it('adjusts calories for goal', () => {
    expect(dailyTargets({ ...dad, goal: 'lose' }).kcal).toBeCloseTo(2681.5 * 0.85);
    expect(dailyTargets({ ...dad, goal: 'gain' }).kcal).toBeCloseTo(2681.5 * 1.1);
  });
  it('never returns negative carbs', () => {
    const tiny = { ...dad, weightKg: 200, activity: 'sedentary' as const, goal: 'lose' as const };
    expect(dailyTargets(tiny).carbs).toBeGreaterThanOrEqual(0);
  });
});

describe('dinnerTargets', () => {
  it('scales daily targets by the dinner share', () => {
    const d = dailyTargets(dad);
    const t = dinnerTargets(dad, 0.35);
    expect(t.kcal).toBeCloseTo(d.kcal * 0.35);
    expect(t.protein).toBeCloseTo(d.protein * 0.35);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/lib/macro/targets.test.ts`
Expected: FAIL — cannot resolve `./targets`.

- [ ] **Step 4: Implement `src/lib/macro/targets.ts`**

```ts
import type { ActivityLevel, Goal, MacroSet, PersonProfile } from './types';

const ACTIVITY: Record<ActivityLevel, number> = {
  sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9,
};
const GOAL: Record<Goal, number> = { lose: 0.85, maintain: 1, gain: 1.1 };

export function bmr(p: Pick<PersonProfile, 'age' | 'sex' | 'weightKg' | 'heightCm'>): number {
  return 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age + (p.sex === 'male' ? 5 : -161);
}

export function dailyTargets(p: PersonProfile): MacroSet {
  const kcal = bmr(p) * ACTIVITY[p.activity] * GOAL[p.goal];
  const protein = 1.8 * p.weightKg;
  const fat = (kcal * 0.25) / 9;
  const carbs = Math.max(0, (kcal - protein * 4 - fat * 9) / 4);
  return { kcal, protein, carbs, fat };
}

export function dinnerTargets(p: PersonProfile, share = 0.35): MacroSet {
  const d = dailyTargets(p);
  return {
    kcal: d.kcal * share,
    protein: d.protein * share,
    carbs: d.carbs * share,
    fat: d.fat * share,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/macro/targets.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/macro/types.ts src/lib/macro/targets.ts src/lib/macro/targets.test.ts
git commit -m "feat: macro types and daily/dinner target calculation"
```

---

### Task 3: Portion solver

**Files:**
- Create: `src/lib/macro/portions.ts`
- Test: `src/lib/macro/portions.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/lib/macro/portions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { scale, solvePortions } from './portions';
import type { MacroSet } from './types';

const perServing: MacroSet = { kcal: 600, protein: 40, carbs: 55, fat: 20 };

describe('scale', () => {
  it('multiplies every macro', () => {
    expect(scale(perServing, 1.5)).toEqual({ kcal: 900, protein: 60, carbs: 82.5, fat: 30 });
  });
});

describe('solvePortions', () => {
  it('rounds servings to nearest 0.25 to hit each person kcal target', () => {
    const { portions, householdServings } = solvePortions(perServing, [
      { personId: 'dad', target: { kcal: 930, protein: 50, carbs: 90, fat: 26 } },  // 1.55 → 1.5
      { personId: 'kid', target: { kcal: 450, protein: 25, carbs: 45, fat: 14 } },  // 0.75
    ]);
    expect(portions[0].servings).toBe(1.5);
    expect(portions[1].servings).toBe(0.75);
    expect(householdServings).toBeCloseTo(2.25);
  });
  it('flags portions outside 10% kcal tolerance', () => {
    const { portions } = solvePortions(perServing, [
      { personId: 'a', target: { kcal: 900, protein: 1, carbs: 1, fat: 1 } },   // 1.5 → 900 exact
      { personId: 'b', target: { kcal: 2500, protein: 1, carbs: 1, fat: 1 } },  // clamped to 3 → 1800, off
    ]);
    expect(portions[0].withinTolerance).toBe(true);
    expect(portions[1].withinTolerance).toBe(false);
  });
  it('clamps servings to [0.5, 3]', () => {
    const { portions } = solvePortions(perServing, [
      { personId: 'tiny', target: { kcal: 100, protein: 1, carbs: 1, fat: 1 } },
      { personId: 'huge', target: { kcal: 9000, protein: 1, carbs: 1, fat: 1 } },
    ]);
    expect(portions[0].servings).toBe(0.5);
    expect(portions[1].servings).toBe(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/macro/portions.test.ts`
Expected: FAIL — cannot resolve `./portions`.

- [ ] **Step 3: Implement `src/lib/macro/portions.ts`**

```ts
import type { MacroSet } from './types';

export type PortionInput = { personId: string; target: MacroSet };
export type Portion = {
  personId: string;
  servings: number;
  achieved: MacroSet;
  withinTolerance: boolean;
};

const STEP = 0.25;
const MIN = 0.5;
const MAX = 3;
const TOLERANCE = 0.1;

export function scale(m: MacroSet, factor: number): MacroSet {
  return {
    kcal: m.kcal * factor,
    protein: m.protein * factor,
    carbs: m.carbs * factor,
    fat: m.fat * factor,
  };
}

export function solvePortions(
  perServing: MacroSet,
  targets: PortionInput[],
): { portions: Portion[]; householdServings: number } {
  const portions = targets.map(({ personId, target }) => {
    const raw = target.kcal / perServing.kcal;
    const servings = Math.min(MAX, Math.max(MIN, Math.round(raw / STEP) * STEP));
    const achieved = scale(perServing, servings);
    const withinTolerance =
      Math.abs(achieved.kcal - target.kcal) / target.kcal <= TOLERANCE;
    return { personId, servings, achieved, withinTolerance };
  });
  return {
    portions,
    householdServings: portions.reduce((sum, p) => sum + p.servings, 0),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/macro/portions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/macro/portions.ts src/lib/macro/portions.test.ts
git commit -m "feat: per-person portion solver with tolerance flag"
```

---

### Task 4: Weekly macro tally

**Files:**
- Create: `src/lib/macro/tally.ts`
- Test: `src/lib/macro/tally.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/lib/macro/tally.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { weeklyTally, weeklyTargetFor } from './tally';
import type { MacroSet } from './types';

const night: MacroSet = { kcal: 2000, protein: 120, carbs: 200, fat: 70 };

describe('weeklyTargetFor', () => {
  it('sums per-person dinner targets across people and days', () => {
    const a: MacroSet = { kcal: 900, protein: 50, carbs: 90, fat: 25 };
    const b: MacroSet = { kcal: 500, protein: 30, carbs: 50, fat: 15 };
    const t = weeklyTargetFor([a, b], 7);
    expect(t.kcal).toBe((900 + 500) * 7);
    expect(t.protein).toBe(80 * 7);
  });
});

describe('weeklyTally', () => {
  it('sums nights and marks each macro ok within 10%', () => {
    const target = weeklyTargetFor([night], 7); // exactly 7 nights of `night`
    const { totals, status } = weeklyTally(Array(7).fill(night), target);
    expect(totals.kcal).toBe(14000);
    expect(status).toEqual({ kcal: 'ok', protein: 'ok', carbs: 'ok', fat: 'ok' });
  });
  it('marks over and under outside 10%', () => {
    const target: MacroSet = { kcal: 14000, protein: 840, carbs: 1400, fat: 490 };
    const { status } = weeklyTally(
      Array(7).fill({ kcal: 2500, protein: 60, carbs: 200, fat: 70 }),
      target,
    );
    expect(status.kcal).toBe('over');   // 17500 / 14000 = 1.25
    expect(status.protein).toBe('under'); // 420 / 840 = 0.5
    expect(status.carbs).toBe('ok');    // 1400 / 1400
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/macro/tally.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/macro/tally.ts`**

```ts
import type { MacroSet } from './types';

export type MacroStatus = 'ok' | 'over' | 'under';
const KEYS = ['kcal', 'protein', 'carbs', 'fat'] as const;
const ZERO: MacroSet = { kcal: 0, protein: 0, carbs: 0, fat: 0 };

export function weeklyTargetFor(personDinnerTargets: MacroSet[], days = 7): MacroSet {
  const perNight = personDinnerTargets.reduce(
    (acc, t) => ({
      kcal: acc.kcal + t.kcal, protein: acc.protein + t.protein,
      carbs: acc.carbs + t.carbs, fat: acc.fat + t.fat,
    }),
    ZERO,
  );
  return { kcal: perNight.kcal * days, protein: perNight.protein * days,
           carbs: perNight.carbs * days, fat: perNight.fat * days };
}

export function weeklyTally(
  nightlyHouseholdTotals: MacroSet[],
  weeklyTarget: MacroSet,
): { totals: MacroSet; status: Record<(typeof KEYS)[number], MacroStatus> } {
  const totals = nightlyHouseholdTotals.reduce(
    (acc, m) => ({
      kcal: acc.kcal + m.kcal, protein: acc.protein + m.protein,
      carbs: acc.carbs + m.carbs, fat: acc.fat + m.fat,
    }),
    ZERO,
  );
  const status = Object.fromEntries(
    KEYS.map((k) => {
      const ratio = weeklyTarget[k] === 0 ? 1 : totals[k] / weeklyTarget[k];
      return [k, ratio > 1.1 ? 'over' : ratio < 0.9 ? 'under' : 'ok'];
    }),
  ) as Record<(typeof KEYS)[number], MacroStatus>;
  return { totals, status };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/macro/tally.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/macro/tally.ts src/lib/macro/tally.test.ts
git commit -m "feat: weekly macro tally with per-macro status"
```

---

### Task 5: Ingredient aggregation, pantry filter, staples check

**Files:**
- Create: `src/lib/macro/aggregate.ts`
- Test: `src/lib/macro/aggregate.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/lib/macro/aggregate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { aggregateIngredients, staplesUsed } from './aggregate';
import type { Ingredient } from './types';

const ing = (name: string, quantity: number, unit: string, section: Ingredient['section'] = 'other'): Ingredient =>
  ({ name, quantity, unit, section });

describe('aggregateIngredients', () => {
  it('merges same ingredient+unit across dinners, scaled', () => {
    const items = aggregateIngredients(
      [
        { ingredients: [ing('Onion', 2, 'pcs', 'produce')], scale: 1 },
        { ingredients: [ing('onion', 1, 'pcs', 'produce')], scale: 2 },
      ],
      [],
    );
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(4); // 2*1 + 1*2
  });
  it('keeps incompatible units as separate line items', () => {
    const items = aggregateIngredients(
      [{ ingredients: [ing('spinach', 1, 'bunch', 'produce'), ing('spinach', 200, 'g', 'produce')], scale: 1 }],
      [],
    );
    expect(items).toHaveLength(2);
  });
  it('filters pantry staples case-insensitively', () => {
    const items = aggregateIngredients(
      [{ ingredients: [ing('Olive Oil', 2, 'tbsp', 'pantry'), ing('chicken', 500, 'g', 'meat_fish')], scale: 1 }],
      ['olive oil'],
    );
    expect(items.map((i) => i.name)).toEqual(['chicken']);
  });
  it('sorts by store section order then name', () => {
    const items = aggregateIngredients(
      [{ ingredients: [ing('rice', 200, 'g', 'pantry'), ing('apple', 4, 'pcs', 'produce'), ing('beef', 400, 'g', 'meat_fish')], scale: 1 }],
      [],
    );
    expect(items.map((i) => i.section)).toEqual(['produce', 'meat_fish', 'pantry']);
  });
});

describe('staplesUsed', () => {
  it('returns only the staples this week needs, with quantities', () => {
    const used = staplesUsed(
      [
        { ingredients: [ing('olive oil', 2, 'tbsp', 'pantry'), ing('chicken', 500, 'g', 'meat_fish')], scale: 1.5 },
        { ingredients: [ing('Olive Oil', 1, 'tbsp', 'pantry')], scale: 1 },
      ],
      ['olive oil', 'salt'],
    );
    expect(used).toHaveLength(1);
    expect(used[0].name.toLowerCase()).toBe('olive oil');
    expect(used[0].quantity).toBe(4); // 2*1.5 + 1
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/macro/aggregate.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/macro/aggregate.ts`**

```ts
import type { Ingredient, StoreSection } from './types';

export type ShoppingItem = { name: string; quantity: number; unit: string; section: StoreSection };
export type ScaledRecipe = { ingredients: Ingredient[]; scale: number };

export const SECTION_ORDER: StoreSection[] = ['produce', 'meat_fish', 'dairy', 'pantry', 'frozen', 'other'];

const norm = (s: string) => s.trim().toLowerCase();

function merge(dinners: ScaledRecipe[], include: (name: string) => boolean): ShoppingItem[] {
  const map = new Map<string, ShoppingItem>();
  for (const { ingredients, scale } of dinners) {
    for (const i of ingredients) {
      if (!include(norm(i.name))) continue;
      const key = `${norm(i.name)}|${norm(i.unit)}`;
      const existing = map.get(key);
      if (existing) existing.quantity += i.quantity * scale;
      else map.set(key, { name: i.name, quantity: i.quantity * scale, unit: i.unit, section: i.section });
    }
  }
  return [...map.values()].sort(
    (a, b) => SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section) || a.name.localeCompare(b.name),
  );
}

export function aggregateIngredients(dinners: ScaledRecipe[], staples: string[]): ShoppingItem[] {
  const stapleSet = new Set(staples.map(norm));
  return merge(dinners, (name) => !stapleSet.has(name));
}

export function staplesUsed(dinners: ScaledRecipe[], staples: string[]): ShoppingItem[] {
  const stapleSet = new Set(staples.map(norm));
  return merge(dinners, (name) => stapleSet.has(name));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/macro/aggregate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/macro/aggregate.ts src/lib/macro/aggregate.test.ts
git commit -m "feat: ingredient aggregation with pantry filter and staples check"
```

---

### Task 6: AI output sanity checks

**Files:**
- Create: `src/lib/macro/validate.ts`
- Test: `src/lib/macro/validate.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/lib/macro/validate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { energyConsistent, violatesAllergies } from './validate';
import type { Ingredient } from './types';

describe('energyConsistent (4/4/9 rule, ±15%)', () => {
  it('accepts macros that roughly match kcal', () => {
    // 4*40 + 4*55 + 9*20 = 560 vs 600 → 6.7% off
    expect(energyConsistent({ kcal: 600, protein: 40, carbs: 55, fat: 20 })).toBe(true);
  });
  it('rejects macros far from kcal', () => {
    // computed 560 vs claimed 1000 → 44% off
    expect(energyConsistent({ kcal: 1000, protein: 40, carbs: 55, fat: 20 })).toBe(false);
  });
  it('rejects zero or negative kcal', () => {
    expect(energyConsistent({ kcal: 0, protein: 0, carbs: 0, fat: 0 })).toBe(false);
  });
});

describe('violatesAllergies', () => {
  const ings: Ingredient[] = [
    { name: 'peanut butter', quantity: 2, unit: 'tbsp', section: 'pantry' },
    { name: 'chicken breast', quantity: 500, unit: 'g', section: 'meat_fish' },
  ];
  it('returns matched allergens (substring, case-insensitive)', () => {
    expect(violatesAllergies(ings, ['Peanut', 'shellfish'])).toEqual(['Peanut']);
  });
  it('returns empty array when clean', () => {
    expect(violatesAllergies(ings, ['shellfish'])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/macro/validate.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/macro/validate.ts`**

```ts
import type { Ingredient, MacroSet } from './types';

export function energyConsistent(m: MacroSet, tolerance = 0.15): boolean {
  if (m.kcal <= 0) return false;
  const computed = 4 * m.protein + 4 * m.carbs + 9 * m.fat;
  return Math.abs(m.kcal - computed) / m.kcal <= tolerance;
}

export function violatesAllergies(ingredients: Ingredient[], allergies: string[]): string[] {
  return allergies.filter((a) =>
    ingredients.some((i) => i.name.toLowerCase().includes(a.toLowerCase())),
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/macro/validate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/macro/validate.ts src/lib/macro/validate.test.ts
git commit -m "feat: AI output sanity checks (energy consistency, allergy re-screen)"
```

---

### Task 7: AI recipe generation module

**Files:**
- Create: `src/lib/ai/schema.ts`, `src/lib/ai/recipes.ts`
- Test: `src/lib/ai/recipes.test.ts`

All tests use injected fake generators — **no live AI calls in tests**.

- [ ] **Step 1: Create the Zod schemas**

`src/lib/ai/schema.ts`:

```ts
import { z } from 'zod';

export const macroSetSchema = z.object({
  kcal: z.number(), protein: z.number(), carbs: z.number(), fat: z.number(),
});

export const ingredientSchema = z.object({
  name: z.string(),
  quantity: z.number(),
  unit: z.string(),
  section: z.enum(['produce', 'meat_fish', 'dairy', 'pantry', 'frozen', 'other']),
});

export const aiRecipeSchema = z.object({
  name: z.string(),
  cuisine: z.string(),
  method: z.string(),
  servings: z.number().int().positive(),
  perServing: macroSetSchema,
  tags: z.array(z.string()),
  ingredients: z.array(ingredientSchema).min(1),
});
export type AiRecipe = z.infer<typeof aiRecipeSchema>;

export const macroEstimateSchema = z.object({
  perServing: macroSetSchema,
  ingredients: z.array(ingredientSchema).min(1),
});
export type MacroEstimate = z.infer<typeof macroEstimateSchema>;
```

- [ ] **Step 2: Write the failing tests**

`src/lib/ai/recipes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { generateRecipe, type RecipeRequest } from './recipes';
import type { AiRecipe } from './schema';

const goodRecipe: AiRecipe = {
  name: 'Chicken stir-fry', cuisine: 'chinese', method: 'Stir fry everything.',
  servings: 4,
  perServing: { kcal: 600, protein: 40, carbs: 55, fat: 20 }, // 4/4/9-consistent
  tags: [],
  ingredients: [{ name: 'chicken breast', quantity: 500, unit: 'g', section: 'meat_fish' }],
};

const req: RecipeRequest = {
  cuisine: 'chinese', targetPerServing: { kcal: 600, protein: 40, carbs: 55, fat: 20 },
  allergies: ['peanut'], dislikes: [], dietTags: [], avoidNames: [],
};

describe('generateRecipe', () => {
  it('returns a valid recipe from the generator', async () => {
    expect(await generateRecipe(req, async () => goodRecipe)).toEqual(goodRecipe);
  });
  it('rejects energy-inconsistent output, retries once, returns the retry', async () => {
    const bad = { ...goodRecipe, perServing: { kcal: 2000, protein: 40, carbs: 55, fat: 20 } };
    let calls = 0;
    const gen = async () => (++calls === 1 ? bad : goodRecipe);
    expect(await generateRecipe(req, gen)).toEqual(goodRecipe);
    expect(calls).toBe(2);
  });
  it('rejects allergy-violating output', async () => {
    const allergenic = {
      ...goodRecipe,
      ingredients: [{ name: 'peanut sauce', quantity: 3, unit: 'tbsp', section: 'pantry' as const }],
    };
    expect(await generateRecipe(req, async () => allergenic)).toBeNull();
  });
  it('returns null when the generator keeps throwing (AI down)', async () => {
    expect(await generateRecipe(req, async () => { throw new Error('timeout'); })).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/lib/ai/recipes.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement `src/lib/ai/recipes.ts`**

```ts
import { generateObject } from 'ai';
import type { MacroSet } from '@/lib/macro/types';
import { energyConsistent, violatesAllergies } from '@/lib/macro/validate';
import { aiRecipeSchema, macroEstimateSchema, type AiRecipe, type MacroEstimate } from './schema';

const MODEL = () => process.env.AI_MODEL ?? 'anthropic/claude-haiku-4.5';
const TIMEOUT_MS = 20_000;

export type RecipeRequest = {
  cuisine: string;
  targetPerServing: MacroSet;
  allergies: string[];
  dislikes: string[];
  dietTags: string[];     // e.g. ['vegetarian']
  avoidNames: string[];   // recent recipe names, for variety
};

export type Generator = (req: RecipeRequest) => Promise<AiRecipe>;

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
    `Assign each ingredient a realistic supermarket section.`,
  ].filter(Boolean).join('\n');
}

export const aiGenerator: Generator = async (req) => {
  const { object } = await generateObject({
    model: MODEL(),
    schema: aiRecipeSchema,
    prompt: buildPrompt(req),
    abortSignal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return object;
};

/** Generate one recipe; validates output, retries once, returns null on failure (never throws). */
export async function generateRecipe(
  req: RecipeRequest,
  gen: Generator = aiGenerator,
): Promise<AiRecipe | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const recipe = await gen(req);
      if (!energyConsistent(recipe.perServing)) continue;
      if (violatesAllergies(recipe.ingredients, req.allergies).length > 0) continue;
      return recipe;
    } catch {
      // timeout / network / schema error — retry once, then give up
    }
  }
  return null;
}

export type Estimator = (input: { name: string; servings: number; ingredientLines: string }) => Promise<MacroEstimate>;

export const aiEstimator: Estimator = async (input) => {
  const { object } = await generateObject({
    model: MODEL(),
    schema: macroEstimateSchema,
    prompt: [
      `Estimate per-serving macros for "${input.name}" (${input.servings} servings) and structure its ingredients.`,
      `kcal must equal 4*protein + 4*carbs + 9*fat within 10%.`,
      `Assign each ingredient a realistic supermarket section.`,
      `Ingredients (one per line, may include quantities):`,
      input.ingredientLines,
    ].join('\n'),
    abortSignal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return object;
};

/** Estimate macros for a user-entered recipe; returns null on failure (never throws). */
export async function estimateRecipe(
  input: { name: string; servings: number; ingredientLines: string },
  est: Estimator = aiEstimator,
): Promise<MacroEstimate | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const e = await est(input);
      if (energyConsistent(e.perServing)) return e;
    } catch { /* retry once */ }
  }
  return null;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/ai/recipes.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/
git commit -m "feat: AI recipe generation and macro estimation with validation and fallback"
```

---

### Task 8: Week drafting (favourites + AI mix, cuisine variety)

**Files:**
- Create: `src/lib/planner/draft.ts`
- Test: `src/lib/planner/draft.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/lib/planner/draft.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { cuisineSequence, draftWeek, type FavouriteRecipe } from './draft';
import type { AiRecipe } from '@/lib/ai/schema';

const fav = (name: string, cuisine: string, tags: string[] = []): FavouriteRecipe => ({
  id: `fav-${name}`, name, cuisine, method: '', servings: 4,
  perServing: { kcal: 600, protein: 40, carbs: 55, fat: 20 }, tags,
  ingredients: [{ name: 'x', quantity: 1, unit: 'pcs', section: 'other' }],
});

const aiRecipe = (name: string, cuisine: string, tags: string[] = []): AiRecipe => ({
  name, cuisine, method: 'cook', servings: 4,
  perServing: { kcal: 600, protein: 40, carbs: 55, fat: 20 }, tags,
  ingredients: [{ name: 'y', quantity: 1, unit: 'pcs', section: 'other' }],
});

describe('cuisineSequence', () => {
  it('never schedules the same cuisine on adjacent days (≥2 cuisines)', () => {
    const seq = cuisineSequence(['indian', 'mexican', 'italian'], 7, () => 0);
    expect(seq).toHaveLength(7);
    for (let i = 1; i < 7; i++) expect(seq[i]).not.toBe(seq[i - 1]);
  });
  it('allows repeats with a single cuisine', () => {
    expect(cuisineSequence(['italian'], 3, () => 0)).toEqual(['italian', 'italian', 'italian']);
  });
  it("returns 'any' slots when no cuisines configured", () => {
    expect(cuisineSequence([], 2, () => 0)).toEqual(['any', 'any']);
  });
});

describe('draftWeek', () => {
  const favourites = [fav('Tacos', 'mexican'), fav('Curry', 'indian'), fav('Pasta bake', 'italian')];

  it('fills 7 days mixing favourites and AI', async () => {
    const days = await draftWeek({
      favourites, cuisines: ['mexican', 'indian', 'italian'], recentNames: [],
      pinned: new Map(), vegetarianNights: 0, rng: () => 0,
      generate: async (req) => aiRecipe(`AI ${req.cuisine}`, req.cuisine, req.dietTags),
    });
    expect(days).toHaveLength(7);
    expect(days.some((d) => d.source === 'favourite')).toBe(true);
    expect(days.some((d) => d.source === 'ai')).toBe(true);
    const names = days.map((d) => d.recipe.name.toLowerCase());
    expect(new Set(names).size).toBe(7); // no repeats within the week
  });

  it('falls back to favourites only when AI returns null', async () => {
    const days = await draftWeek({
      favourites, cuisines: ['mexican'], recentNames: [],
      pinned: new Map(), vegetarianNights: 0, rng: () => 0,
      generate: async () => null,
    });
    expect(days.every((d) => d.source === 'favourite')).toBe(true);
    expect(days.length).toBeGreaterThan(0);
  });

  it('preserves pinned days', async () => {
    const pinnedDinner = { day: 1, source: 'favourite' as const, recipeId: 'fav-Tacos', recipe: favourites[0] };
    const days = await draftWeek({
      favourites, cuisines: ['indian', 'italian'], recentNames: [],
      pinned: new Map([[1, pinnedDinner]]), vegetarianNights: 0, rng: () => 0,
      generate: async (req) => aiRecipe(`AI ${req.cuisine} ${Math.random()}`, req.cuisine),
    });
    expect(days.find((d) => d.day === 1)).toEqual(pinnedDinner);
  });

  it('avoids recent recipe names', async () => {
    const days = await draftWeek({
      favourites, cuisines: ['mexican', 'indian', 'italian'], recentNames: ['Tacos'],
      pinned: new Map(), vegetarianNights: 0, rng: () => 0,
      generate: async (req) => aiRecipe(`AI ${req.cuisine}`, req.cuisine),
    });
    expect(days.map((d) => d.recipe.name)).not.toContain('Tacos');
  });

  it('requests vegetarian dinners for the configured number of nights', async () => {
    const vegRequests: number[] = [];
    const days = await draftWeek({
      favourites: [], cuisines: ['indian', 'italian'], recentNames: [],
      pinned: new Map(), vegetarianNights: 2, rng: () => 0,
      generate: async (req) => {
        if (req.dietTags.includes('vegetarian')) vegRequests.push(1);
        return aiRecipe(`AI ${req.cuisine} ${req.dietTags.join('')} ${vegRequests.length}`, req.cuisine, req.dietTags);
      },
    });
    expect(days.filter((d) => d.recipe.tags.includes('vegetarian'))).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/planner/draft.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/planner/draft.ts`**

```ts
import type { RecipeData } from '@/lib/macro/types';
import type { AiRecipe } from '@/lib/ai/schema';

export type FavouriteRecipe = RecipeData & { id: string };
export type DraftDinner = {
  day: number;                 // 0 = Monday … 6 = Sunday
  source: 'favourite' | 'ai';
  recipeId?: string;           // set for favourites (existing DB row)
  recipe: RecipeData;
};

export type DraftGenerateRequest = { cuisine: string; dietTags: string[]; avoidNames: string[] };

export function cuisineSequence(
  cuisines: string[],
  length: number,
  rng: () => number = Math.random,
): string[] {
  if (cuisines.length === 0) return Array(length).fill('any');
  const seq: string[] = [];
  let last = '';
  for (let i = 0; i < length; i++) {
    let candidates = cuisines.filter((c) => c !== last);
    if (candidates.length === 0) candidates = cuisines; // single-cuisine household
    const pick = candidates[Math.floor(rng() * candidates.length)];
    seq.push(pick);
    last = pick;
  }
  return seq;
}

function pickFavourite(
  favourites: FavouriteRecipe[],
  cuisine: string | null,
  used: Set<string>,
  dietTags: string[],
): FavouriteRecipe | null {
  const fresh = favourites.filter(
    (f) =>
      !used.has(f.name.toLowerCase()) &&
      dietTags.every((t) => f.tags.includes(t)) &&
      (cuisine === null || cuisine === 'any' || f.cuisine.toLowerCase() === cuisine.toLowerCase()),
  );
  return fresh[0] ?? null;
}

export async function draftWeek(opts: {
  favourites: FavouriteRecipe[];
  cuisines: string[];
  recentNames: string[];
  pinned: Map<number, DraftDinner>;
  vegetarianNights: number;
  generate: (req: DraftGenerateRequest) => Promise<AiRecipe | null>;
  rng?: () => number;
}): Promise<DraftDinner[]> {
  const seq = cuisineSequence(opts.cuisines, 7, opts.rng);
  const used = new Set(opts.recentNames.map((n) => n.toLowerCase()));
  for (const p of opts.pinned.values()) used.add(p.recipe.name.toLowerCase());

  let vegRemaining = opts.vegetarianNights;
  const result: DraftDinner[] = [];

  for (let day = 0; day < 7; day++) {
    const pinnedDinner = opts.pinned.get(day);
    if (pinnedDinner) { result.push(pinnedDinner); continue; }

    const cuisine = seq[day];
    const dietTags = vegRemaining > 0 ? ['vegetarian'] : [];
    const wantFavourite = day % 2 === 0; // ~half favourites, half AI
    const favMatch = pickFavourite(opts.favourites, cuisine, used, dietTags);

    let dinner: DraftDinner | null = null;
    if (wantFavourite && favMatch) {
      dinner = { day, source: 'favourite', recipeId: favMatch.id, recipe: favMatch };
    } else {
      const ai = await opts.generate({ cuisine, dietTags, avoidNames: [...used] });
      if (ai) dinner = { day, source: 'ai', recipe: ai };
      else if (favMatch) dinner = { day, source: 'favourite', recipeId: favMatch.id, recipe: favMatch };
    }
    if (!dinner) {
      // last resort: any unused favourite regardless of cuisine/diet
      const any = pickFavourite(opts.favourites, null, used, []);
      if (any) dinner = { day, source: 'favourite', recipeId: any.id, recipe: any };
    }
    if (dinner) {
      used.add(dinner.recipe.name.toLowerCase());
      if (dietTags.length && dinner.recipe.tags.includes('vegetarian')) vegRemaining--;
      result.push(dinner);
    }
    // If still null (no favourites at all + AI down), the day is simply skipped;
    // the UI shows an empty slot and the user can retry.
  }
  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/planner/draft.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/planner/
git commit -m "feat: week drafting with cuisine variety, favourites/AI mix, pins and veg nights"
```

---

### Task 9: Database schema, client, migrations

**Files:**
- Create: `src/lib/db/schema.ts`, `src/lib/db/index.ts`
- Create (generated): `drizzle/0000_*.sql`

- [ ] **Step 1: Create `src/lib/db/schema.ts`**

```ts
import {
  boolean, date, integer, jsonb, pgTable, real, text, timestamp, uuid,
} from 'drizzle-orm/pg-core';
import type { Ingredient, MacroSet } from '@/lib/macro/types';
import type { Portion } from '@/lib/macro/portions';
import type { ShoppingItem } from '@/lib/macro/aggregate';

export const people = pgTable('people', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  age: integer('age').notNull(),
  sex: text('sex', { enum: ['male', 'female'] }).notNull(),
  weightKg: real('weight_kg').notNull(),
  heightCm: real('height_cm').notNull(),
  activity: text('activity', { enum: ['sedentary', 'light', 'moderate', 'active', 'very_active'] }).notNull(),
  goal: text('goal', { enum: ['lose', 'maintain', 'gain'] }).notNull(),
  allergies: jsonb('allergies').$type<string[]>().notNull().default([]),
  dislikes: jsonb('dislikes').$type<string[]>().notNull().default([]),
});

export const recipes = pgTable('recipes', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  cuisine: text('cuisine').notNull().default('any'),
  method: text('method').notNull().default(''),
  servings: integer('servings').notNull().default(4),
  perServing: jsonb('per_serving').$type<MacroSet>().notNull(),
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  source: text('source', { enum: ['family', 'ai'] }).notNull().default('family'),
  ingredients: jsonb('ingredients').$type<Ingredient[]>().notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const weekPlans = pgTable('week_plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  weekStart: date('week_start').notNull().unique(), // Monday, YYYY-MM-DD
});

export const plannedDinners = pgTable('planned_dinners', {
  id: uuid('id').primaryKey().defaultRandom(),
  weekPlanId: uuid('week_plan_id').notNull().references(() => weekPlans.id, { onDelete: 'cascade' }),
  day: integer('day').notNull(), // 0 = Monday … 6 = Sunday
  recipeId: uuid('recipe_id').notNull().references(() => recipes.id),
  householdServings: real('household_servings').notNull(),
  portions: jsonb('portions').$type<Portion[]>().notNull(),
  pinned: boolean('pinned').notNull().default(false),
});

export const pantryStaples = pgTable('pantry_staples', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
});

export type StoredShoppingItem = ShoppingItem & { checked: boolean; manual: boolean };

export const shoppingLists = pgTable('shopping_lists', {
  id: uuid('id').primaryKey().defaultRandom(),
  weekPlanId: uuid('week_plan_id').notNull().unique().references(() => weekPlans.id, { onDelete: 'cascade' }),
  items: jsonb('items').$type<StoredShoppingItem[]>().notNull().default([]),
});

export const settings = pgTable('settings', {
  id: integer('id').primaryKey().default(1), // singleton row
  dinnerShare: real('dinner_share').notNull().default(0.35),
  cuisines: jsonb('cuisines').$type<string[]>().notNull().default([]),
  vegetarianNights: integer('vegetarian_nights').notNull().default(0),
});
```

- [ ] **Step 2: Create `src/lib/db/index.ts`**

```ts
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema';

// Driver-agnostic type so services work against Neon (prod) and PGlite (tests).
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

let _db: Db | null = null;
export function getDb(): Db {
  if (!_db) _db = drizzle(neon(process.env.DATABASE_URL!), { schema }) as unknown as Db;
  return _db;
}
```

- [ ] **Step 3: Generate the migration**

```bash
npm run db:generate
```

Expected: `drizzle/0000_*.sql` created containing `CREATE TABLE` statements for all 7 tables.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Apply schema to Neon (requires DATABASE_URL from Task 1)**

```bash
npm run db:push
```

Expected: tables created (verify: `db:push` reports success). If `DATABASE_URL` isn't configured yet, note it and continue — the integration tests (Task 11) run against PGlite and don't need Neon.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/ drizzle/
git commit -m "feat: drizzle schema, db client, and initial migration"
```

---

### Task 10: Auth (shared household password)

**Files:**
- Create: `src/lib/auth.ts`, `src/middleware.ts`, `src/app/login/page.tsx`, `src/app/actions/auth.ts`
- Test: `src/lib/auth.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/lib/auth.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { sessionToken, isValidSession, SESSION_COOKIE } from './auth';

describe('auth', () => {
  beforeEach(() => { process.env.AUTH_SECRET = 'test-secret'; });

  it('produces a deterministic token from AUTH_SECRET', async () => {
    expect(await sessionToken()).toBe(await sessionToken());
    expect(await sessionToken()).toMatch(/^[0-9a-f]{64}$/);
  });
  it('changes with the secret', async () => {
    const a = await sessionToken();
    process.env.AUTH_SECRET = 'other-secret';
    expect(await sessionToken()).not.toBe(a);
  });
  it('validates only the correct token', async () => {
    expect(await isValidSession(await sessionToken())).toBe(true);
    expect(await isValidSession('nope')).toBe(false);
    expect(await isValidSession(undefined)).toBe(false);
  });
  it('exports a cookie name', () => {
    expect(SESSION_COOKIE).toBe('dp_session');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/auth.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/auth.ts`** (Web Crypto — works in middleware and Node)

```ts
export const SESSION_COOKIE = 'dp_session';

export async function sessionToken(): Promise<string> {
  const data = new TextEncoder().encode(`dinner-planner:${process.env.AUTH_SECRET}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function isValidSession(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  return token === (await sessionToken());
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/auth.test.ts`
Expected: PASS.

- [ ] **Step 5: Create `src/app/actions/auth.ts`**

```ts
'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, sessionToken } from '@/lib/auth';

export async function login(formData: FormData) {
  const password = formData.get('password');
  if (password !== process.env.HOUSEHOLD_PASSWORD) {
    redirect('/login?error=1');
  }
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, await sessionToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: '/',
  });
  redirect('/');
}
```

- [ ] **Step 6: Create `src/app/login/page.tsx`**

```tsx
import { login } from '@/app/actions/auth';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto mt-24 max-w-sm p-6">
      <h1 className="mb-4 text-2xl font-bold">Dinner Planner</h1>
      <form action={login} className="space-y-3">
        <input
          type="password" name="password" placeholder="Household password" required
          className="w-full rounded border p-2"
        />
        {error && <p className="text-sm text-red-600">Wrong password.</p>}
        <button type="submit" className="w-full rounded bg-emerald-700 p-2 text-white">
          Enter
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 7: Create `src/middleware.ts`**

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { isValidSession, SESSION_COOKIE } from '@/lib/auth';

export async function middleware(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (await isValidSession(token)) return NextResponse.next();
  return NextResponse.redirect(new URL('/login', request.url));
}

export const config = {
  // Everything except login, Next internals, and static assets
  matcher: ['/((?!login|_next|favicon.ico|.*\\.png$).*)'],
};
```

- [ ] **Step 8: Manual verification**

```bash
npm run dev -- --port 3100 &
sleep 5
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:3100/        # expect 307 → /login
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3100/login                   # expect 200
kill %1
```

- [ ] **Step 9: Commit**

```bash
git add src/lib/auth.ts src/lib/auth.test.ts src/middleware.ts src/app/login src/app/actions/auth.ts
git commit -m "feat: shared household password auth with session cookie and middleware"
```

---

### Task 11: Services + helpers + integration tests (PGlite)

**Files:**
- Create: `src/lib/services/dates.ts`, `src/lib/services/ingredients.ts`, `src/lib/services/planning.ts`, `src/lib/services/shopping.ts`
- Test: `src/lib/services/dates.test.ts`, `src/lib/services/ingredients.test.ts`, `tests/integration/flows.test.ts`

- [ ] **Step 1: Write failing tests for the small helpers**

`src/lib/services/dates.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { currentWeekStart } from './dates';

describe('currentWeekStart', () => {
  it('returns the Monday of the week containing the given date', () => {
    expect(currentWeekStart(new Date('2026-06-11T10:00:00Z'))).toBe('2026-06-08'); // Thu → Mon
    expect(currentWeekStart(new Date('2026-06-08T00:00:00Z'))).toBe('2026-06-08'); // Mon → same
    expect(currentWeekStart(new Date('2026-06-14T23:00:00Z'))).toBe('2026-06-08'); // Sun → prev Mon
  });
});
```

`src/lib/services/ingredients.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseIngredientLines } from './ingredients';

describe('parseIngredientLines', () => {
  it('parses "qty unit name" lines', () => {
    expect(parseIngredientLines('200 g chicken breast\n2 pcs onion')).toEqual([
      { name: 'chicken breast', quantity: 200, unit: 'g', section: 'other' },
      { name: 'onion', quantity: 2, unit: 'pcs', section: 'other' },
    ]);
  });
  it('defaults quantity 1 pcs for bare names and skips blank lines', () => {
    expect(parseIngredientLines('lemon\n\n')).toEqual([
      { name: 'lemon', quantity: 1, unit: 'pcs', section: 'other' },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/services/dates.test.ts src/lib/services/ingredients.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the helpers**

`src/lib/services/dates.ts`:

```ts
/** Monday (YYYY-MM-DD, UTC) of the week containing `now`. */
export function currentWeekStart(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = d.getUTCDay(); // 0 = Sunday
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
```

`src/lib/services/ingredients.ts`:

```ts
import type { Ingredient } from '@/lib/macro/types';

/** Parse "200 g chicken breast" style lines. Sections default to 'other' (AI estimate refines them). */
export function parseIngredientLines(text: string): Ingredient[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^([\d.]+)\s+(\S+)\s+(.+)$/);
      if (m) return { name: m[3], quantity: parseFloat(m[1]), unit: m[2], section: 'other' as const };
      return { name: line, quantity: 1, unit: 'pcs', section: 'other' as const };
    });
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/lib/services/dates.test.ts src/lib/services/ingredients.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement `src/lib/services/planning.ts`**

```ts
import { and, desc, eq, ne } from 'drizzle-orm';
import type { Db } from '@/lib/db';
import {
  people, plannedDinners, recipes, settings, shoppingLists, weekPlans,
} from '@/lib/db/schema';
import { dinnerTargets } from '@/lib/macro/targets';
import { scale, solvePortions } from '@/lib/macro/portions';
import { weeklyTally, weeklyTargetFor } from '@/lib/macro/tally';
import { draftWeek, type DraftDinner, type DraftGenerateRequest } from '@/lib/planner/draft';
import { generateRecipe, aiGenerator, type Generator } from '@/lib/ai/recipes';
import type { MacroSet } from '@/lib/macro/types';

export async function getSettings(db: Db) {
  const [row] = await db.select().from(settings).where(eq(settings.id, 1));
  if (row) return row;
  const [created] = await db.insert(settings).values({ id: 1 }).returning();
  return created;
}

export async function getOrCreateWeekPlan(db: Db, weekStart: string) {
  const [existing] = await db.select().from(weekPlans).where(eq(weekPlans.weekStart, weekStart));
  if (existing) return existing;
  const [created] = await db.insert(weekPlans).values({ weekStart }).returning();
  return created;
}

async function loadContext(db: Db) {
  const household = await db.select().from(people);
  const config = await getSettings(db);
  const favourites = await db.select().from(recipes).where(eq(recipes.source, 'family'));
  const allergies = [...new Set(household.flatMap((p) => p.allergies))];
  const dislikes = [...new Set(household.flatMap((p) => p.dislikes))];
  const targets = household.map((p) => ({
    personId: p.id,
    target: dinnerTargets(p, config.dinnerShare),
  }));
  const avgTarget: MacroSet = targets.length
    ? {
        kcal: targets.reduce((s, t) => s + t.target.kcal, 0) / targets.length,
        protein: targets.reduce((s, t) => s + t.target.protein, 0) / targets.length,
        carbs: targets.reduce((s, t) => s + t.target.carbs, 0) / targets.length,
        fat: targets.reduce((s, t) => s + t.target.fat, 0) / targets.length,
      }
    : { kcal: 650, protein: 35, carbs: 65, fat: 22 };
  return { household, config, favourites, allergies, dislikes, targets, avgTarget };
}

async function persistDinner(db: Db, weekPlanId: string, dinner: DraftDinner, targets: { personId: string; target: MacroSet }[]) {
  let recipeId = dinner.recipeId;
  if (!recipeId) {
    const [saved] = await db.insert(recipes).values({ ...dinner.recipe, source: 'ai' }).returning();
    recipeId = saved.id;
  }
  const { portions, householdServings } = solvePortions(dinner.recipe.perServing, targets);
  await db.insert(plannedDinners).values({
    weekPlanId, day: dinner.day, recipeId, householdServings, portions, pinned: false,
  });
}

/** Draft and persist a full week. Returns true if AI was unavailable (favourites-only fallback). */
export async function planWeek(db: Db, weekStart: string, gen: Generator = aiGenerator): Promise<{ aiDegraded: boolean }> {
  const ctx = await loadContext(db);
  const plan = await getOrCreateWeekPlan(db, weekStart);

  const existing = await db.select().from(plannedDinners).where(eq(plannedDinners.weekPlanId, plan.id));
  const pinnedRows = existing.filter((d) => d.pinned);
  const pinned = new Map<number, DraftDinner>();
  for (const row of pinnedRows) {
    const [r] = await db.select().from(recipes).where(eq(recipes.id, row.recipeId));
    pinned.set(row.day, { day: row.day, source: r.source === 'ai' ? 'ai' : 'favourite', recipeId: r.id, recipe: r });
  }
  await db.delete(plannedDinners).where(and(eq(plannedDinners.weekPlanId, plan.id), eq(plannedDinners.pinned, false)));

  const recent = await db.select().from(recipes).orderBy(desc(recipes.createdAt)).limit(20);
  let aiFailed = false;
  const generate = async (req: DraftGenerateRequest) => {
    const result = await generateRecipe(
      {
        cuisine: req.cuisine, targetPerServing: ctx.avgTarget,
        allergies: ctx.allergies, dislikes: ctx.dislikes,
        dietTags: req.dietTags, avoidNames: req.avoidNames,
      },
      gen,
    );
    if (result === null) aiFailed = true;
    return result;
  };

  const days = await draftWeek({
    favourites: ctx.favourites, cuisines: ctx.config.cuisines,
    recentNames: recent.map((r) => r.name),
    pinned, vegetarianNights: ctx.config.vegetarianNights, generate,
  });

  for (const dinner of days) {
    if (pinned.has(dinner.day)) continue; // already persisted
    await persistDinner(db, plan.id, dinner, ctx.targets);
  }
  // a re-plan invalidates any existing list
  await db.delete(shoppingLists).where(eq(shoppingLists.weekPlanId, plan.id));
  return { aiDegraded: aiFailed };
}

/** Replace one day. mode: 'favourite' | 'ai' | 'ai-same-cuisine', or pass an explicit recipeId. */
export async function swapDay(
  db: Db, weekStart: string, day: number,
  mode: 'favourite' | 'ai' | 'ai-same-cuisine' | { recipeId: string },
  gen: Generator = aiGenerator,
): Promise<{ ok: boolean }> {
  const ctx = await loadContext(db);
  const plan = await getOrCreateWeekPlan(db, weekStart);
  const week = await db.select().from(plannedDinners).where(eq(plannedDinners.weekPlanId, plan.id));
  const current = week.find((d) => d.day === day);
  const currentRecipe = current
    ? (await db.select().from(recipes).where(eq(recipes.id, current.recipeId)))[0]
    : null;
  const usedNames = new Set<string>();
  for (const d of week) {
    const [r] = await db.select().from(recipes).where(eq(recipes.id, d.recipeId));
    if (r) usedNames.add(r.name.toLowerCase());
  }

  let replacement: DraftDinner | null = null;
  if (typeof mode === 'object') {
    const [r] = await db.select().from(recipes).where(eq(recipes.id, mode.recipeId));
    if (r) replacement = { day, source: r.source === 'ai' ? 'ai' : 'favourite', recipeId: r.id, recipe: r };
  } else if (mode === 'favourite') {
    const fav = ctx.favourites.find((f) => !usedNames.has(f.name.toLowerCase()));
    if (fav) replacement = { day, source: 'favourite', recipeId: fav.id, recipe: fav };
  } else {
    const cuisine = mode === 'ai-same-cuisine' && currentRecipe ? currentRecipe.cuisine : (ctx.config.cuisines[0] ?? 'any');
    const ai = await generateRecipe(
      {
        cuisine, targetPerServing: ctx.avgTarget,
        allergies: ctx.allergies, dislikes: ctx.dislikes,
        dietTags: [], avoidNames: [...usedNames],
      },
      gen,
    );
    if (ai) replacement = { day, source: 'ai', recipe: ai };
  }
  if (!replacement) return { ok: false };

  await db.delete(plannedDinners).where(and(eq(plannedDinners.weekPlanId, plan.id), eq(plannedDinners.day, day)));
  await persistDinner(db, plan.id, replacement, ctx.targets);
  await db.delete(shoppingLists).where(eq(shoppingLists.weekPlanId, plan.id));
  return { ok: true };
}

export async function togglePin(db: Db, weekStart: string, day: number): Promise<void> {
  const plan = await getOrCreateWeekPlan(db, weekStart);
  const [row] = await db.select().from(plannedDinners)
    .where(and(eq(plannedDinners.weekPlanId, plan.id), eq(plannedDinners.day, day)));
  if (row) {
    await db.update(plannedDinners).set({ pinned: !row.pinned }).where(eq(plannedDinners.id, row.id));
  }
}

/** Everything the Plan page needs in one call. */
export async function getWeek(db: Db, weekStart: string) {
  const ctx = await loadContext(db);
  const plan = await getOrCreateWeekPlan(db, weekStart);
  const rows = await db.select().from(plannedDinners).where(eq(plannedDinners.weekPlanId, plan.id));
  const dinners = await Promise.all(
    rows.sort((a, b) => a.day - b.day).map(async (row) => {
      const [recipe] = await db.select().from(recipes).where(eq(recipes.id, row.recipeId));
      return { ...row, recipe };
    }),
  );
  const nightly = dinners.map((d) => scale(d.recipe.perServing, d.householdServings));
  const tally = weeklyTally(nightly, weeklyTargetFor(ctx.targets.map((t) => t.target), 7));
  return { plan, dinners, tally, people: ctx.household, settings: ctx.config };
}
```

- [ ] **Step 6: Implement `src/lib/services/shopping.ts`**

```ts
import { eq } from 'drizzle-orm';
import type { Db } from '@/lib/db';
import { pantryStaples, plannedDinners, recipes, shoppingLists, weekPlans, type StoredShoppingItem } from '@/lib/db/schema';
import { aggregateIngredients, staplesUsed, type ScaledRecipe } from '@/lib/macro/aggregate';

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

/** Staples this week's dinners actually use — shown before building the list. */
export async function staplesCheck(db: Db, weekStart: string) {
  const staples = await db.select().from(pantryStaples);
  const dinners = await weekScaledRecipes(db, weekStart);
  return staplesUsed(dinners, staples.map((s) => s.name));
}

export async function buildList(db: Db, weekStart: string, lowStapleNames: string[]) {
  const [plan] = await db.select().from(weekPlans).where(eq(weekPlans.weekStart, weekStart));
  if (!plan) return null;
  const staples = await db.select().from(pantryStaples);
  const dinners = await weekScaledRecipes(db, weekStart);

  const items: StoredShoppingItem[] = aggregateIngredients(dinners, staples.map((s) => s.name))
    .map((i) => ({ ...i, checked: false, manual: false }));
  const low = staplesUsed(dinners, staples.map((s) => s.name))
    .filter((s) => lowStapleNames.some((n) => n.toLowerCase() === s.name.toLowerCase()))
    .map((i) => ({ ...i, checked: false, manual: false }));
  items.push(...low);

  // Spec: manually added items survive a rebuild.
  const [existing] = await db.select().from(shoppingLists).where(eq(shoppingLists.weekPlanId, plan.id));
  if (existing) items.push(...existing.items.filter((i) => i.manual));

  await db.delete(shoppingLists).where(eq(shoppingLists.weekPlanId, plan.id));
  const [list] = await db.insert(shoppingLists).values({ weekPlanId: plan.id, items }).returning();
  return list;
}

export async function getList(db: Db, weekStart: string) {
  const [plan] = await db.select().from(weekPlans).where(eq(weekPlans.weekStart, weekStart));
  if (!plan) return null;
  const [list] = await db.select().from(shoppingLists).where(eq(shoppingLists.weekPlanId, plan.id));
  return list ?? null;
}

export async function toggleItem(db: Db, listId: string, index: number) {
  const [list] = await db.select().from(shoppingLists).where(eq(shoppingLists.id, listId));
  if (!list || !list.items[index]) return;
  const items = [...list.items];
  items[index] = { ...items[index], checked: !items[index].checked };
  await db.update(shoppingLists).set({ items }).where(eq(shoppingLists.id, listId));
}

export async function addItem(db: Db, listId: string, name: string) {
  const [list] = await db.select().from(shoppingLists).where(eq(shoppingLists.id, listId));
  if (!list) return;
  const items = [...list.items, { name, quantity: 1, unit: 'pcs', section: 'other' as const, checked: false, manual: true }];
  await db.update(shoppingLists).set({ items }).where(eq(shoppingLists.id, listId));
}

export async function removeItem(db: Db, listId: string, index: number) {
  const [list] = await db.select().from(shoppingLists).where(eq(shoppingLists.id, listId));
  if (!list) return;
  const items = list.items.filter((_, i) => i !== index);
  await db.update(shoppingLists).set({ items }).where(eq(shoppingLists.id, listId));
}
```

- [ ] **Step 7: Write the integration test (PGlite, fake AI)**

`tests/integration/flows.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '@/lib/db/schema';
import type { Db } from '@/lib/db';
import { getWeek, planWeek, swapDay, togglePin } from '@/lib/services/planning';
import { addItem, buildList, getList, staplesCheck, toggleItem } from '@/lib/services/shopping';
import type { AiRecipe } from '@/lib/ai/schema';

const WEEK = '2026-06-08';

let aiCounter = 0;
const fakeAi = async (req: { cuisine: string }): Promise<AiRecipe> => ({
  name: `AI dinner ${++aiCounter}`, cuisine: req.cuisine, method: 'cook', servings: 4,
  perServing: { kcal: 600, protein: 40, carbs: 55, fat: 20 },
  tags: [],
  ingredients: [
    { name: 'onion', quantity: 1, unit: 'pcs', section: 'produce' },
    { name: 'olive oil', quantity: 1, unit: 'tbsp', section: 'pantry' },
  ],
});

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: './drizzle' });
  await db.insert(schema.people).values([
    { name: 'Dad', age: 40, sex: 'male', weightKg: 80, heightCm: 180, activity: 'moderate', goal: 'maintain', allergies: [], dislikes: [] },
    { name: 'Kid', age: 10, sex: 'female', weightKg: 35, heightCm: 140, activity: 'active', goal: 'maintain', allergies: ['peanut'], dislikes: [] },
  ]);
  await db.insert(schema.settings).values({ id: 1, cuisines: ['mexican', 'italian'], vegetarianNights: 0 });
  await db.insert(schema.recipes).values({
    name: 'Tacos', cuisine: 'mexican', method: 'assemble', servings: 4,
    perServing: { kcal: 650, protein: 35, carbs: 60, fat: 25 }, tags: [], source: 'family',
    ingredients: [
      { name: 'beef mince', quantity: 500, unit: 'g', section: 'meat_fish' },
      { name: 'olive oil', quantity: 2, unit: 'tbsp', section: 'pantry' },
    ],
  });
  await db.insert(schema.pantryStaples).values({ name: 'olive oil' });
  return db;
}

describe('plan → swap → shopping list flow', () => {
  let db: Db;
  beforeEach(async () => { aiCounter = 0; db = await freshDb(); });

  it('plans a 7-day week with portions for each person', async () => {
    const { aiDegraded } = await planWeek(db, WEEK, fakeAi);
    expect(aiDegraded).toBe(false);
    const week = await getWeek(db, WEEK);
    expect(week.dinners).toHaveLength(7);
    for (const d of week.dinners) {
      expect(d.portions).toHaveLength(2);
      expect(d.householdServings).toBeGreaterThan(0);
    }
    expect(week.tally.totals.kcal).toBeGreaterThan(0);
  });

  it('falls back to favourites-only when AI fails, and reports it', async () => {
    const { aiDegraded } = await planWeek(db, WEEK, async () => { throw new Error('down'); });
    expect(aiDegraded).toBe(true);
    const week = await getWeek(db, WEEK);
    expect(week.dinners.length).toBeGreaterThanOrEqual(1); // only 1 favourite seeded
  });

  it('swaps a day and pins survive re-planning', async () => {
    await planWeek(db, WEEK, fakeAi);
    const before = (await getWeek(db, WEEK)).dinners.find((d) => d.day === 2)!;
    await swapDay(db, WEEK, 2, 'ai', fakeAi);
    const after = (await getWeek(db, WEEK)).dinners.find((d) => d.day === 2)!;
    expect(after.recipe.name).not.toBe(before.recipe.name);

    await togglePin(db, WEEK, 2);
    await planWeek(db, WEEK, fakeAi);
    const rePlanned = (await getWeek(db, WEEK)).dinners.find((d) => d.day === 2)!;
    expect(rePlanned.recipe.name).toBe(after.recipe.name);
  });

  it('builds a shopping list: aggregated, staples filtered, low staples added back', async () => {
    await planWeek(db, WEEK, fakeAi);
    const used = await staplesCheck(db, WEEK);
    expect(used.map((u) => u.name.toLowerCase())).toContain('olive oil');

    const list = await buildList(db, WEEK, ['olive oil']);
    expect(list).not.toBeNull();
    const names = list!.items.map((i) => i.name.toLowerCase());
    expect(names).toContain('olive oil');           // tapped as low → included
    expect(names).toContain('onion');
    expect(list!.items.filter((i) => i.name.toLowerCase() === 'onion')).toHaveLength(1); // aggregated

    await toggleItem(db, list!.id, 0);
    const reloaded = await getList(db, WEEK);
    expect(reloaded!.items[0].checked).toBe(true);
  });

  it('manually added items survive a rebuild', async () => {
    await planWeek(db, WEEK, fakeAi);
    const list = await buildList(db, WEEK, []);
    await addItem(db, list!.id, 'birthday candles');
    const rebuilt = await buildList(db, WEEK, []);
    expect(rebuilt!.items.map((i) => i.name)).toContain('birthday candles');
  });
});
```

- [ ] **Step 8: Run the integration tests**

Run: `npx vitest run tests/integration/flows.test.ts`
Expected: PASS (4 tests). If migration fails, re-run `npm run db:generate` first — the migrations folder must exist.

- [ ] **Step 9: Run the full suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 10: Commit**

```bash
git add src/lib/services/ tests/
git commit -m "feat: planning and shopping services with PGlite integration tests"
```

---

### Task 12: App shell, Family page

**Files:**
- Create: `src/app/(app)/layout.tsx`, `src/app/(app)/family/page.tsx`, `src/app/actions/family.ts`
- Modify: delete scaffold `src/app/page.tsx` content (replaced in Task 14); move it under `(app)` route group

- [ ] **Step 1: Create the route group layout `src/app/(app)/layout.tsx`**

```tsx
import Link from 'next/link';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl p-4">
      <nav className="mb-6 flex gap-4 border-b pb-3 text-sm font-medium">
        <Link href="/" className="hover:underline">📅 Plan</Link>
        <Link href="/shopping" className="hover:underline">🛒 Shopping</Link>
        <Link href="/recipes" className="hover:underline">📖 Recipes</Link>
        <Link href="/family" className="hover:underline">👪 Family</Link>
      </nav>
      {children}
    </div>
  );
}
```

Move the scaffold home page into the group so the layout applies: `git mv src/app/page.tsx src/app/(app)/page.tsx` (its content is replaced in Task 14 — for now replace the body with `<h1>Plan</h1>` placeholder so it compiles without scaffold cruft):

```tsx
export default function PlanPage() {
  return <h1 className="text-2xl font-bold">Plan</h1>;
}
```

- [ ] **Step 2: Create `src/app/actions/family.ts`**

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { pantryStaples, people, settings } from '@/lib/db/schema';

const list = (v: FormDataEntryValue | null) =>
  String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

export async function savePerson(formData: FormData) {
  const db = getDb();
  const values = {
    name: String(formData.get('name')),
    age: Number(formData.get('age')),
    sex: String(formData.get('sex')) as 'male' | 'female',
    weightKg: Number(formData.get('weightKg')),
    heightCm: Number(formData.get('heightCm')),
    activity: String(formData.get('activity')) as 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active',
    goal: String(formData.get('goal')) as 'lose' | 'maintain' | 'gain',
    allergies: list(formData.get('allergies')),
    dislikes: list(formData.get('dislikes')),
  };
  const id = formData.get('id');
  if (id) await db.update(people).set(values).where(eq(people.id, String(id)));
  else await db.insert(people).values(values);
  revalidatePath('/family');
}

export async function deletePerson(formData: FormData) {
  await getDb().delete(people).where(eq(people.id, String(formData.get('id'))));
  revalidatePath('/family');
}

export async function saveSettings(formData: FormData) {
  const db = getDb();
  const values = {
    dinnerShare: Number(formData.get('dinnerShare')) / 100,
    cuisines: list(formData.get('cuisines')),
    vegetarianNights: Number(formData.get('vegetarianNights')),
  };
  await db.insert(settings).values({ id: 1, ...values })
    .onConflictDoUpdate({ target: settings.id, set: values });
  revalidatePath('/family');
}

export async function addStaple(formData: FormData) {
  const name = String(formData.get('name')).trim();
  if (name) await getDb().insert(pantryStaples).values({ name }).onConflictDoNothing();
  revalidatePath('/family');
}

export async function removeStaple(formData: FormData) {
  await getDb().delete(pantryStaples).where(eq(pantryStaples.id, String(formData.get('id'))));
  revalidatePath('/family');
}
```

- [ ] **Step 3: Create `src/app/(app)/family/page.tsx`**

```tsx
import { getDb } from '@/lib/db';
import { pantryStaples, people, settings } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { dailyTargets, dinnerTargets } from '@/lib/macro/targets';
import { addStaple, deletePerson, removeStaple, savePerson, saveSettings } from '@/app/actions/family';

export const dynamic = 'force-dynamic';

export default async function FamilyPage() {
  const db = getDb();
  const household = await db.select().from(people);
  const [config] = await db.select().from(settings).where(eq(settings.id, 1));
  const staples = await db.select().from(pantryStaples);
  const share = config?.dinnerShare ?? 0.35;

  return (
    <main className="space-y-8">
      <section>
        <h1 className="mb-3 text-2xl font-bold">Family</h1>
        <ul className="space-y-2">
          {household.map((p) => {
            const daily = dailyTargets(p);
            const dinner = dinnerTargets(p, share);
            return (
              <li key={p.id} className="rounded border p-3">
                <div className="flex items-center justify-between">
                  <strong>{p.name}</strong>
                  <form action={deletePerson}>
                    <input type="hidden" name="id" value={p.id} />
                    <button className="text-sm text-red-600">remove</button>
                  </form>
                </div>
                <p className="text-sm text-gray-600">
                  {p.age}y · {p.weightKg}kg · {p.goal} · daily {Math.round(daily.kcal)} kcal
                  · dinner target {Math.round(dinner.kcal)} kcal / P{Math.round(dinner.protein)}g
                </p>
                {p.allergies.length > 0 && <p className="text-sm text-red-700">⚠ allergies: {p.allergies.join(', ')}</p>}
                {p.dislikes.length > 0 && <p className="text-sm text-gray-500">dislikes: {p.dislikes.join(', ')}</p>}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="rounded border p-4">
        <h2 className="mb-2 font-semibold">Add person</h2>
        <form action={savePerson} className="grid grid-cols-2 gap-2 text-sm">
          <input name="name" placeholder="Name" required className="rounded border p-2" />
          <input name="age" type="number" placeholder="Age" required className="rounded border p-2" />
          <select name="sex" className="rounded border p-2">
            <option value="male">male</option><option value="female">female</option>
          </select>
          <input name="weightKg" type="number" step="0.5" placeholder="Weight (kg)" required className="rounded border p-2" />
          <input name="heightCm" type="number" placeholder="Height (cm)" required className="rounded border p-2" />
          <select name="activity" className="rounded border p-2">
            <option value="sedentary">sedentary</option><option value="light">light</option>
            <option value="moderate">moderate</option><option value="active">active</option>
            <option value="very_active">very active</option>
          </select>
          <select name="goal" className="rounded border p-2">
            <option value="maintain">maintain</option><option value="lose">lose</option><option value="gain">gain</option>
          </select>
          <input name="allergies" placeholder="Allergies (comma-separated)" className="rounded border p-2" />
          <input name="dislikes" placeholder="Dislikes (comma-separated)" className="rounded border p-2" />
          <button className="col-span-2 rounded bg-emerald-700 p-2 text-white">Save person</button>
        </form>
      </section>

      <section className="rounded border p-4">
        <h2 className="mb-2 font-semibold">Household settings</h2>
        <form action={saveSettings} className="flex flex-wrap items-end gap-3 text-sm">
          <label>Dinner share (% of daily kcal)
            <input name="dinnerShare" type="number" min="10" max="60" defaultValue={Math.round(share * 100)} className="block rounded border p-2" />
          </label>
          <label>Preferred cuisines (comma-separated)
            <input name="cuisines" defaultValue={(config?.cuisines ?? []).join(', ')} className="block w-72 rounded border p-2" />
          </label>
          <label>Vegetarian nights / week
            <input name="vegetarianNights" type="number" min="0" max="7" defaultValue={config?.vegetarianNights ?? 0} className="block rounded border p-2" />
          </label>
          <button className="rounded bg-emerald-700 p-2 text-white">Save settings</button>
        </form>
      </section>

      <section className="rounded border p-4">
        <h2 className="mb-2 font-semibold">Pantry staples (never on the list unless you flag them low)</h2>
        <ul className="mb-3 flex flex-wrap gap-2">
          {staples.map((s) => (
            <li key={s.id} className="flex items-center gap-1 rounded bg-gray-100 px-2 py-1 text-sm">
              {s.name}
              <form action={removeStaple}><input type="hidden" name="id" value={s.id} /><button className="text-red-600">×</button></form>
            </li>
          ))}
        </ul>
        <form action={addStaple} className="flex gap-2 text-sm">
          <input name="name" placeholder="e.g. olive oil" className="rounded border p-2" />
          <button className="rounded bg-emerald-700 px-3 text-white">Add</button>
        </form>
      </section>
    </main>
  );
}
```

- [ ] **Step 4: Verify build and manual check**

```bash
npx tsc --noEmit && npm run build
```

Expected: build succeeds. Then with `DATABASE_URL` configured: `npm run dev`, log in, visit `/family`, add a person, confirm dinner-target line renders.

- [ ] **Step 5: Commit**

```bash
git add src/app
git commit -m "feat: app shell and family page (profiles, settings, staples)"
```

---

### Task 13: Recipes page with AI macro estimation

**Files:**
- Create: `src/app/(app)/recipes/page.tsx`, `src/app/actions/recipes.ts`

- [ ] **Step 1: Create `src/app/actions/recipes.ts`**

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { recipes } from '@/lib/db/schema';
import { estimateRecipe } from '@/lib/ai/recipes';
import { parseIngredientLines } from '@/lib/services/ingredients';

export async function saveRecipe(formData: FormData) {
  const db = getDb();
  const name = String(formData.get('name'));
  const servings = Number(formData.get('servings')) || 4;
  const ingredientLines = String(formData.get('ingredients'));
  const useAi = formData.get('estimateWithAi') === 'on';

  let perServing = {
    kcal: Number(formData.get('kcal')) || 0,
    protein: Number(formData.get('protein')) || 0,
    carbs: Number(formData.get('carbs')) || 0,
    fat: Number(formData.get('fat')) || 0,
  };
  let ingredients = parseIngredientLines(ingredientLines);

  if (useAi) {
    const estimate = await estimateRecipe({ name, servings, ingredientLines });
    if (estimate) {
      perServing = estimate.perServing;
      ingredients = estimate.ingredients;
    }
    // if AI is down, fall back to whatever was typed — never block saving
  }

  await db.insert(recipes).values({
    name,
    cuisine: String(formData.get('cuisine')) || 'any',
    method: String(formData.get('method') ?? ''),
    servings,
    perServing,
    tags: String(formData.get('tags') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    source: 'family',
    ingredients,
  });
  revalidatePath('/recipes');
}

export async function deleteRecipe(formData: FormData) {
  await getDb().delete(recipes).where(eq(recipes.id, String(formData.get('id'))));
  revalidatePath('/recipes');
}

export async function promoteToFavourite(formData: FormData) {
  await getDb().update(recipes).set({ source: 'family' })
    .where(eq(recipes.id, String(formData.get('id'))));
  revalidatePath('/recipes');
}
```

- [ ] **Step 2: Create `src/app/(app)/recipes/page.tsx`**

```tsx
import { desc } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { recipes } from '@/lib/db/schema';
import { deleteRecipe, promoteToFavourite, saveRecipe } from '@/app/actions/recipes';

export const dynamic = 'force-dynamic';

export default async function RecipesPage() {
  const all = await getDb().select().from(recipes).orderBy(desc(recipes.createdAt));
  const favourites = all.filter((r) => r.source === 'family');
  const aiOnes = all.filter((r) => r.source === 'ai');

  return (
    <main className="space-y-8">
      <section>
        <h1 className="mb-3 text-2xl font-bold">Favourites ({favourites.length})</h1>
        <ul className="grid gap-2 sm:grid-cols-2">
          {favourites.map((r) => (
            <li key={r.id} className="rounded border p-3 text-sm">
              <div className="flex justify-between">
                <strong>{r.name}</strong>
                <form action={deleteRecipe}><input type="hidden" name="id" value={r.id} /><button className="text-red-600">remove</button></form>
              </div>
              <p className="text-gray-600">
                {r.cuisine} · {Math.round(r.perServing.kcal)} kcal · P{Math.round(r.perServing.protein)} C{Math.round(r.perServing.carbs)} F{Math.round(r.perServing.fat)}
                {r.tags.length > 0 && <> · {r.tags.join(', ')}</>}
              </p>
              <details className="mt-1">
                <summary className="cursor-pointer text-gray-500">ingredients & method</summary>
                <ul className="ml-4 list-disc">{r.ingredients.map((i, idx) => <li key={idx}>{i.quantity} {i.unit} {i.name}</li>)}</ul>
                <p className="mt-1 whitespace-pre-wrap">{r.method}</p>
              </details>
            </li>
          ))}
        </ul>
      </section>

      {aiOnes.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">AI-suggested (from past plans)</h2>
          <ul className="space-y-1 text-sm">
            {aiOnes.map((r) => (
              <li key={r.id} className="flex items-center gap-3">
                {r.name} ({r.cuisine})
                <form action={promoteToFavourite}>
                  <input type="hidden" name="id" value={r.id} />
                  <button className="text-emerald-700 underline">★ save as favourite</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded border p-4">
        <h2 className="mb-2 font-semibold">Add recipe</h2>
        <form action={saveRecipe} className="grid gap-2 text-sm">
          <div className="grid grid-cols-3 gap-2">
            <input name="name" placeholder="Name" required className="rounded border p-2" />
            <input name="cuisine" placeholder="Cuisine (e.g. italian)" className="rounded border p-2" />
            <input name="servings" type="number" defaultValue={4} className="rounded border p-2" />
          </div>
          <textarea name="ingredients" rows={4} required className="rounded border p-2"
            placeholder={'One ingredient per line, e.g.\n500 g chicken breast\n2 pcs onion'} />
          <textarea name="method" rows={3} placeholder="Method (optional)" className="rounded border p-2" />
          <input name="tags" placeholder="Tags, comma-separated (e.g. vegetarian)" className="rounded border p-2" />
          <div className="grid grid-cols-4 gap-2">
            <input name="kcal" type="number" placeholder="kcal/serving" className="rounded border p-2" />
            <input name="protein" type="number" placeholder="protein g" className="rounded border p-2" />
            <input name="carbs" type="number" placeholder="carbs g" className="rounded border p-2" />
            <input name="fat" type="number" placeholder="fat g" className="rounded border p-2" />
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="estimateWithAi" defaultChecked />
            Estimate macros & store sections with AI (overrides the numbers above)
          </label>
          <button className="rounded bg-emerald-700 p-2 text-white">Save recipe</button>
        </form>
      </section>
    </main>
  );
}
```

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit && npm run build
```

Expected: success. Manual: add a recipe with AI estimation on; macros appear on the card.

- [ ] **Step 4: Commit**

```bash
git add src/app
git commit -m "feat: recipes page with AI macro estimation"
```

---

### Task 14: Plan page (week-at-a-glance grid)

**Files:**
- Create: `src/app/actions/plan.ts`
- Modify: `src/app/(app)/page.tsx` (replace placeholder)

- [ ] **Step 1: Create `src/app/actions/plan.ts`**

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db';
import { currentWeekStart } from '@/lib/services/dates';
import { planWeek, swapDay, togglePin } from '@/lib/services/planning';
import { redirect } from 'next/navigation';

export async function planMyWeek() {
  const { aiDegraded } = await planWeek(getDb(), currentWeekStart());
  revalidatePath('/');
  if (aiDegraded) redirect('/?degraded=1');
}

export async function swapDayAction(formData: FormData) {
  const day = Number(formData.get('day'));
  const mode = String(formData.get('mode')) as 'favourite' | 'ai' | 'ai-same-cuisine';
  await swapDay(getDb(), currentWeekStart(), day, mode);
  revalidatePath('/');
}

export async function togglePinAction(formData: FormData) {
  await togglePin(getDb(), currentWeekStart(), Number(formData.get('day')));
  revalidatePath('/');
}
```

- [ ] **Step 2: Replace `src/app/(app)/page.tsx`**

```tsx
import Link from 'next/link';
import { getDb } from '@/lib/db';
import { currentWeekStart, DAY_NAMES } from '@/lib/services/dates';
import { getWeek } from '@/lib/services/planning';
import { planMyWeek, swapDayAction, togglePinAction } from '@/app/actions/plan';

export const dynamic = 'force-dynamic';

const STATUS_ICON = { ok: '✅', over: '🔺', under: '🔻' } as const;

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ degraded?: string }>;
}) {
  const { degraded } = await searchParams;
  const weekStart = currentWeekStart();
  const week = await getWeek(getDb(), weekStart);
  const personName = (id: string) => week.people.find((p) => p.id === id)?.name ?? '?';

  return (
    <main className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Week of {weekStart}</h1>
        <div className="flex gap-2">
          <form action={planMyWeek}>
            <button className="rounded bg-emerald-700 px-3 py-2 text-sm text-white">
              {week.dinners.length ? '↻ Re-plan week' : 'Plan my week'}
            </button>
          </form>
          <Link href="/shopping" className="rounded border px-3 py-2 text-sm">🛒 Shopping list</Link>
        </div>
      </div>

      {degraded && (
        <p className="rounded bg-amber-100 p-2 text-sm">
          AI suggestions were unavailable — this week was drafted from favourites only.
        </p>
      )}

      {week.people.length === 0 && (
        <p className="rounded bg-blue-50 p-3 text-sm">
          Start by adding your family on the <Link className="underline" href="/family">Family page</Link>,
          and a few favourite dinners on the <Link className="underline" href="/recipes">Recipes page</Link>.
        </p>
      )}

      {week.dinners.length > 0 && (
        <p className="rounded bg-gray-50 p-2 text-sm">
          Week macros vs target:{' '}
          {(['kcal', 'protein', 'carbs', 'fat'] as const).map((k) => (
            <span key={k} className="mr-3">
              {k} {Math.round(week.tally.totals[k])} {STATUS_ICON[week.tally.status[k]]}
            </span>
          ))}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 7 }, (_, day) => {
          const dinner = week.dinners.find((d) => d.day === day);
          return (
            <div key={day} className="rounded border p-3 text-sm">
              <div className="flex items-center justify-between">
                <strong>{DAY_NAMES[day]}</strong>
                {dinner && (
                  <form action={togglePinAction}>
                    <input type="hidden" name="day" value={day} />
                    <button title={dinner.pinned ? 'Unpin' : 'Pin (survives re-plan)'}>
                      {dinner.pinned ? '📌' : '📍'}
                    </button>
                  </form>
                )}
              </div>
              {dinner ? (
                <>
                  <p className="font-medium">{dinner.recipe.name}</p>
                  <p className="text-gray-600">
                    {dinner.recipe.cuisine} · {Math.round(dinner.recipe.perServing.kcal)} kcal/serv
                    {dinner.recipe.tags.includes('vegetarian') && ' · 🌱'}
                  </p>
                  {dinner.portions.some((p) => !p.withinTolerance) && (
                    <p className="text-amber-700">⚠ portions off-target for some people</p>
                  )}
                  <details className="mt-1">
                    <summary className="cursor-pointer text-gray-500">portions & recipe</summary>
                    <table className="mt-1 w-full">
                      <tbody>
                        {dinner.portions.map((p) => (
                          <tr key={p.personId}>
                            <td>{personName(p.personId)}</td>
                            <td>×{p.servings}</td>
                            <td>{Math.round(p.achieved.kcal)} kcal {p.withinTolerance ? '' : '⚠'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <ul className="ml-4 mt-1 list-disc">
                      {dinner.recipe.ingredients.map((i, idx) => (
                        <li key={idx}>{i.quantity} {i.unit} {i.name}</li>
                      ))}
                    </ul>
                    <p className="mt-1 whitespace-pre-wrap text-gray-700">{dinner.recipe.method}</p>
                  </details>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {(['favourite', 'ai', 'ai-same-cuisine'] as const).map((mode) => (
                      <form key={mode} action={swapDayAction}>
                        <input type="hidden" name="day" value={day} />
                        <input type="hidden" name="mode" value={mode} />
                        <button className="rounded border px-1.5 py-0.5 text-xs">
                          ↻ {mode === 'favourite' ? 'favourite' : mode === 'ai' ? 'new AI idea' : `more ${dinner.recipe.cuisine}`}
                        </button>
                      </form>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-gray-400">—</p>
              )}
            </div>
          );
        })}
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit && npm run build
```

Expected: success. Manual: with family + recipes set up, "Plan my week" fills the grid; swap and pin work; macro bar shows.

- [ ] **Step 4: Commit**

```bash
git add src/app
git commit -m "feat: plan page with week grid, macro bar, swap and pin"
```

---

### Task 15: Shopping page (staples check + grouped list)

**Files:**
- Create: `src/app/(app)/shopping/page.tsx`, `src/app/actions/shopping.ts`

- [ ] **Step 1: Create `src/app/actions/shopping.ts`**

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db';
import { currentWeekStart } from '@/lib/services/dates';
import { addItem, buildList, removeItem, toggleItem } from '@/lib/services/shopping';

export async function buildListAction(formData: FormData) {
  const low = formData.getAll('lowStaple').map(String);
  await buildList(getDb(), currentWeekStart(), low);
  revalidatePath('/shopping');
}

export async function toggleItemAction(formData: FormData) {
  await toggleItem(getDb(), String(formData.get('listId')), Number(formData.get('index')));
  revalidatePath('/shopping');
}

export async function addItemAction(formData: FormData) {
  const name = String(formData.get('name')).trim();
  if (name) await addItem(getDb(), String(formData.get('listId')), name);
  revalidatePath('/shopping');
}

export async function removeItemAction(formData: FormData) {
  await removeItem(getDb(), String(formData.get('listId')), Number(formData.get('index')));
  revalidatePath('/shopping');
}
```

- [ ] **Step 2: Create `src/app/(app)/shopping/page.tsx`**

```tsx
import Link from 'next/link';
import { getDb } from '@/lib/db';
import { currentWeekStart } from '@/lib/services/dates';
import { getList, staplesCheck } from '@/lib/services/shopping';
import { SECTION_ORDER } from '@/lib/macro/aggregate';
import { addItemAction, buildListAction, removeItemAction, toggleItemAction } from '@/app/actions/shopping';

export const dynamic = 'force-dynamic';

const SECTION_LABEL: Record<string, string> = {
  produce: '🥦 Produce', meat_fish: '🥩 Meat & fish', dairy: '🥛 Dairy',
  pantry: '🥫 Pantry', frozen: '🧊 Frozen', other: '🧺 Other',
};
const fmtQty = (n: number) => (Number.isInteger(n) ? n : Math.round(n * 100) / 100);

export default async function ShoppingPage() {
  const db = getDb();
  const weekStart = currentWeekStart();
  const list = await getList(db, weekStart);

  if (!list) {
    const used = await staplesCheck(db, weekStart);
    return (
      <main className="max-w-lg space-y-4">
        <h1 className="text-2xl font-bold">Shopping list — week of {weekStart}</h1>
        <form action={buildListAction} className="space-y-3 rounded border p-4 text-sm">
          {used.length > 0 ? (
            <>
              <p className="font-medium">This week&apos;s dinners use these staples — tick any you&apos;re running low on:</p>
              <ul className="space-y-1">
                {used.map((s) => (
                  <li key={`${s.name}|${s.unit}`}>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" name="lowStaple" value={s.name} />
                      {s.name} <span className="text-gray-500">(needs ~{fmtQty(s.quantity)} {s.unit})</span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>No pantry staples needed this week.</p>
          )}
          <button className="rounded bg-emerald-700 px-3 py-2 text-white">Build shopping list</button>
        </form>
        <p className="text-sm text-gray-500">
          No dinners planned yet? <Link href="/" className="underline">Plan your week first.</Link>
        </p>
      </main>
    );
  }

  const sections = SECTION_ORDER.filter((s) => list.items.some((i) => i.section === s));
  return (
    <main className="max-w-lg space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Shopping — week of {weekStart}</h1>
        <form action={buildListAction}>
          <button className="rounded border px-2 py-1 text-sm">↻ Rebuild</button>
        </form>
      </div>
      {sections.map((section) => (
        <section key={section}>
          <h2 className="mb-1 font-semibold">{SECTION_LABEL[section]}</h2>
          <ul className="space-y-1 text-sm">
            {list.items.map((item, index) =>
              item.section !== section ? null : (
                <li key={index} className="flex items-center gap-2">
                  <form action={toggleItemAction}>
                    <input type="hidden" name="listId" value={list.id} />
                    <input type="hidden" name="index" value={index} />
                    <button className="w-6 text-left">{item.checked ? '☑' : '☐'}</button>
                  </form>
                  <span className={item.checked ? 'text-gray-400 line-through' : ''}>
                    {fmtQty(item.quantity)} {item.unit} {item.name} {item.manual && <em className="text-gray-400">(added)</em>}
                  </span>
                  <form action={removeItemAction} className="ml-auto">
                    <input type="hidden" name="listId" value={list.id} />
                    <input type="hidden" name="index" value={index} />
                    <button className="text-xs text-red-500">×</button>
                  </form>
                </li>
              ),
            )}
          </ul>
        </section>
      ))}
      <form action={addItemAction} className="flex gap-2 text-sm">
        <input type="hidden" name="listId" value={list.id} />
        <input name="name" placeholder="Add item…" className="rounded border p-2" />
        <button className="rounded bg-emerald-700 px-3 text-white">Add</button>
      </form>
    </main>
  );
}
```

> Note: `buildListAction` doubles as "Rebuild" — when no `lowStaple` boxes are present in the form it rebuilds with no extra staples. Manually added items survive a rebuild (handled in `buildList`); checked-off state of regenerated items resets.

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit && npm run build
```

Expected: success. Manual: plan a week → Shopping shows the staples check → tick one → list is grouped by section, tapped staple included, check-off works on a phone-width viewport.

- [ ] **Step 4: Commit**

```bash
git add src/app
git commit -m "feat: shopping page with staples check and grouped check-off list"
```

---

### Task 16: Final verification

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all unit + integration tests pass.

- [ ] **Step 2: Type check + production build**

```bash
npx tsc --noEmit && npm run build
```

Expected: clean.

- [ ] **Step 3: End-to-end manual smoke test (needs DATABASE_URL + AI Gateway auth)**

```bash
npm run db:push   # if not yet applied
npm run dev
```

In a browser: log in → Family: add 4 people, cuisines `indian, mexican, italian`, staples `olive oil, salt, rice` → Recipes: add 3–4 favourites with AI estimation → Plan: "Plan my week" (expect 7 dinners, no same-cuisine adjacency, portion tables) → swap a day, pin it, re-plan (pin survives) → Shopping: staples check, build list, tick items.

If AI calls fail, confirm the amber "favourites only" banner appears and planning still works.

- [ ] **Step 4: Commit any fixes, then final commit**

```bash
git add -A
git commit -m "chore: final verification fixes"
```

- [ ] **Step 5 (optional, user decision): deploy**

```bash
vercel deploy
```

Set `HOUSEHOLD_PASSWORD`, `AUTH_SECRET` in Vercel project env vars; `DATABASE_URL` comes from the Neon integration; enable AI Gateway in project settings and set a **budget alert + hard cap (~$5/month)** per the spec's Costs & Limits section.
