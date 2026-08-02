# "Pick Manually" Swap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user put a specific recipe on a specific day, via an inline picker on the Plan page with name search.

**Architecture:** `swapDay` has accepted a `{ recipeId }` mode since the original build; nothing could reach it. Add a `pickerOptions` service that lists the library annotated with "already planned this week", a `pick` mode on `swapDayAction` that routes to the existing `{ recipeId }` path, and a single full-width picker panel on the Plan page driven by a `?pick=<day>` search param.

**Tech Stack:** Next.js 16 App Router (server components, server actions), Drizzle ORM, Neon in prod / PGlite in tests, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-01-manual-pick-swap-design.md`

## Global Constraints

- **Day indexing: 0 = Monday … 6 = Sunday.** Weeks are keyed by `weekStart` (Monday, `YYYY-MM-DD`, UTC).
- **No client JS.** Server components and plain forms only — no `'use client'`, no event handlers.
- **Services take a `Db` parameter** (from `@/lib/db`) so the same code runs on Neon and PGlite. Never call `getDb()` inside a service.
- **Server actions stay thin:** parse `FormData`, call a service with `getDb()`, `revalidatePath`. No business logic.
- **No schema change in this plan**, so `db:generate` / `db:push` are not needed. If that changes, run BOTH.
- Existing malformed-id guard to reuse verbatim: `const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;`
- Run the full suite with `npm test`; a single file with `npx vitest run <path>`.

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `src/lib/services/planning.ts` | Add `PickerOption` type + `pickerOptions` query | Modify |
| `src/lib/services/planning.test.ts` | Tests for `pickerOptions` and `swapDay`'s `{ recipeId }` path | Modify |
| `src/app/actions/plan.ts` | Add `pick` mode to `swapDayAction` | Modify |
| `vitest.config.ts` | Allow `.test.tsx` files | Modify |
| `src/app/(app)/PickerPanel.tsx` | `PickLink` + `PickerPanel` presentational components | Create |
| `src/app/(app)/PickerPanel.test.tsx` | Component tests for the above | Create |
| `src/app/(app)/page.tsx` | Wire the links and panel into the page | Modify |

The picker components live in their own module rather than inside
`page.tsx`, following the existing `src/app/(app)/WeekTabs.tsx` precedent.
That is what makes them renderable in a test without dragging in the
page's async data loading.

---

### Task 1: `pickerOptions` service

**Files:**
- Modify: `src/lib/services/planning.ts`
- Test: `src/lib/services/planning.test.ts`

**Interfaces:**
- Consumes: `Db`, the `recipes` / `weekPlans` / `plannedDinners` tables, and `desc` / `eq` from `drizzle-orm` (all already imported at the top of `planning.ts`).
- Produces:
  ```ts
  export type PickerOption = {
    id: string;
    name: string;
    cuisine: string;
    kcal: number;              // rounded perServing.kcal
    favourite: boolean;        // source === 'family'
    plannedDay: number | null; // day it occupies THIS week, else null
  };
  export async function pickerOptions(
    db: Db, weekStart: string, query?: string,
  ): Promise<PickerOption[]>;
  ```

- [ ] **Step 1: Write the failing tests**

Append to the end of `src/lib/services/planning.test.ts`. Add `pickerOptions` to the existing import from `./planning` (it currently reads `import { getWeek, planWeek } from './planning';`).

```ts
describe('pickerOptions', () => {
  const recipeRow = (name: string, source: 'family' | 'ai', createdAt: Date) => ({
    name, cuisine: 'italian', method: '', servings: 4,
    perServing: { kcal: 600.4, protein: 40, carbs: 55, fat: 20 },
    tags: [], equipment: [], source,
    ingredients: [{ name: 'x', quantity: 1, unit: 'pcs', section: 'other' as const }],
    createdAt,
  });

  it('lists favourites before AI dinners, newest first within each group', async () => {
    const db = await createTestDb();
    await db.insert(recipes).values([
      recipeRow('Old Fav', 'family', new Date('2026-01-01')),
      recipeRow('New Fav', 'family', new Date('2026-06-01')),
      recipeRow('Old AI', 'ai', new Date('2026-02-01')),
      recipeRow('New AI', 'ai', new Date('2026-07-01')),
    ]);

    const opts = await pickerOptions(db, '2026-07-06');

    expect(opts.map((o) => o.name)).toEqual(['New Fav', 'Old Fav', 'New AI', 'Old AI']);
    expect(opts[0].favourite).toBe(true);
    expect(opts[3].favourite).toBe(false);
    expect(opts[0].kcal).toBe(600); // rounded for display
  });

  it('filters by name case-insensitively; a blank query filters nothing', async () => {
    const db = await createTestDb();
    await db.insert(recipes).values([
      recipeRow('Chicken Katsu', 'family', new Date('2026-01-01')),
      recipeRow('Beef Rendang', 'family', new Date('2026-01-02')),
    ]);

    const names = async (q?: string) => (await pickerOptions(db, '2026-07-06', q)).map((o) => o.name);

    expect(await names('chick')).toEqual(['Chicken Katsu']);
    expect(await names('KATSU')).toEqual(['Chicken Katsu']);
    expect(await names('   ')).toHaveLength(2);
    expect(await names()).toHaveLength(2);
  });

  it('marks the day a recipe occupies this week and ignores other weeks', async () => {
    const db = await createTestDb();
    await db.insert(people).values(adult);
    await db.insert(settings).values({ id: 1, cuisines: ['italian'], equipment: [] });
    await planWeek(db, '2026-07-06', makeAi([]));

    const thisWeek = await pickerOptions(db, '2026-07-06');
    expect(thisWeek.map((o) => o.plannedDay).sort((a, b) => a! - b!)).toEqual([0, 1, 2, 3, 4, 5, 6]);

    const otherWeek = await pickerOptions(db, '2026-07-13');
    expect(otherWeek.every((o) => o.plannedDay === null)).toBe(true);
  });

  it('does not create a week plan row just by looking', async () => {
    const db = await createTestDb();
    await db.insert(recipes).values([recipeRow('Solo', 'family', new Date('2026-01-01'))]);

    await pickerOptions(db, '2026-07-06');

    expect(await db.select().from(weekPlans)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/services/planning.test.ts`
Expected: FAIL — `pickerOptions` is not exported from `./planning`.

- [ ] **Step 3: Write the implementation**

Add to the end of `src/lib/services/planning.ts`:

```ts
export type PickerOption = {
  id: string;
  name: string;
  cuisine: string;
  kcal: number;
  favourite: boolean;
  plannedDay: number | null;
};

/**
 * Every recipe in the library, for the Plan page's manual picker.
 * Favourites first, then AI dinners from past plans, each newest-first.
 * `plannedDay` marks a recipe already on the board THIS week so the UI can
 * flag a duplicate pick without hiding it.
 *
 * Deliberately reads the week plan rather than getOrCreateWeekPlan — merely
 * opening the picker must not write a row.
 */
export async function pickerOptions(
  db: Db,
  weekStart: string,
  query?: string,
): Promise<PickerOption[]> {
  const all = await db.select().from(recipes).orderBy(desc(recipes.createdAt));
  const [plan] = await db.select().from(weekPlans).where(eq(weekPlans.weekStart, weekStart));

  const dayByRecipe = new Map<string, number>();
  if (plan) {
    const rows = await db.select().from(plannedDinners).where(eq(plannedDinners.weekPlanId, plan.id));
    for (const row of rows) dayByRecipe.set(row.recipeId, row.day);
  }

  const needle = (query ?? '').trim().toLowerCase();
  return all
    .filter((r) => needle === '' || r.name.toLowerCase().includes(needle))
    .map((r) => ({
      id: r.id,
      name: r.name,
      cuisine: r.cuisine,
      kcal: Math.round(r.perServing.kcal),
      favourite: r.source === 'family',
      plannedDay: dayByRecipe.get(r.id) ?? null,
    }))
    // Stable sort (ES2019+): favourites rise, createdAt order survives within each group.
    .sort((a, b) => Number(b.favourite) - Number(a.favourite));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/services/planning.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/services/planning.ts src/lib/services/planning.test.ts
git commit -m "feat: pickerOptions — the recipe library, annotated for this week"
```

---

### Task 2: `pick` mode on `swapDayAction`

**Files:**
- Modify: `src/app/actions/plan.ts`
- Test: `src/lib/services/planning.test.ts`

**Interfaces:**
- Consumes: `swapDay(db, weekStart, day, { recipeId })` from Task 0 of the original build (already exists, returns `Promise<{ ok: boolean }>`).
- Produces: `swapDayAction` accepts `mode=pick` plus a `recipeId` form field. Task 3's picker rows post to it.

**Note on test placement:** the spec called for an action-level test. This repo has no tests for server actions (they are `'use server'` modules that call `getDb()`, `revalidatePath`, and `redirect`), and the action is a thin wrapper by design. The behaviour that matters is tested at the service level instead, and the malformed-id guard reuses the existing `UUID_RE` precedent from `updateRecipeAction`, which is likewise not unit-tested.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/services/planning.test.ts`. Add `swapDay` to the existing import from `./planning`.

```ts
describe('swapDay by explicit recipe id', () => {
  it('puts the chosen recipe on the day', async () => {
    const db = await createTestDb();
    await db.insert(people).values(adult);
    await db.insert(settings).values({ id: 1, cuisines: ['italian'], equipment: [] });
    await planWeek(db, '2026-07-06', makeAi([]));

    const [chosen] = await db.insert(recipes).values({
      name: 'Hand Picked', cuisine: 'italian', method: '', servings: 4,
      perServing: { kcal: 600, protein: 40, carbs: 55, fat: 20 },
      tags: [], equipment: [], source: 'family',
      ingredients: [{ name: 'x', quantity: 1, unit: 'pcs', section: 'other' }],
    }).returning();

    const { ok } = await swapDay(db, '2026-07-06', 2, { recipeId: chosen.id });

    expect(ok).toBe(true);
    const week = await getWeek(db, '2026-07-06');
    expect(week.dinners.find((d) => d.day === 2)!.recipe.name).toBe('Hand Picked');
  });

  it('leaves the day untouched when the recipe no longer exists', async () => {
    const db = await createTestDb();
    await db.insert(people).values(adult);
    await db.insert(settings).values({ id: 1, cuisines: ['italian'], equipment: [] });
    await planWeek(db, '2026-07-06', makeAi([]));
    const before = (await getWeek(db, '2026-07-06')).dinners.find((d) => d.day === 2)!.recipe.name;

    const { ok } = await swapDay(db, '2026-07-06', 2, {
      recipeId: '00000000-0000-4000-8000-000000000000',
    });

    expect(ok).toBe(false);
    const after = (await getWeek(db, '2026-07-06')).dinners.find((d) => d.day === 2)!.recipe.name;
    expect(after).toBe(before);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail or pass**

Run: `npx vitest run src/lib/services/planning.test.ts`
Expected: these two PASS immediately — `swapDay`'s `{ recipeId }` path already exists and this is characterisation coverage for a previously untested branch. If either FAILS, stop: the service does not behave as the spec assumed, and the plan needs revisiting before touching the action.

- [ ] **Step 3: Add the `pick` mode to the action**

In `src/app/actions/plan.ts`, add the guard constant below the existing `weekFrom` helper:

```ts
// A non-UUID id would make the uuid-typed query throw; treat it as a no-op instead.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
```

Then replace `swapDayAction` in full:

```ts
export async function swapDayAction(formData: FormData) {
  const day = Number(formData.get('day'));
  const raw = String(formData.get('mode'));
  const { weekStart, isNext } = weekFrom(formData);

  // Manual pick: route to swapDay's explicit-recipe mode, then redirect so the
  // ?pick= / ?q= params drop and the picker panel closes.
  if (raw === 'pick') {
    const recipeId = String(formData.get('recipeId'));
    if (!UUID_RE.test(recipeId)) return; // malformed id — return without changes
    const { ok } = await swapDay(getDb(), weekStart, day, { recipeId });
    revalidatePath('/');
    const params = new URLSearchParams();
    if (isNext) params.set('week', 'next');
    if (!ok) params.set('error', 'gone'); // deleted between render and submit
    const qs = params.toString();
    redirect(qs ? `/?${qs}` : '/');
  }

  if (!SWAP_MODES.includes(raw as SwapMode)) return;
  await swapDay(getDb(), weekStart, day, raw as SwapMode);
  revalidatePath('/');
}
```

`redirect` and `revalidatePath` are already imported at the top of the file.

- [ ] **Step 4: Run the full suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/actions/plan.ts src/lib/services/planning.test.ts
git commit -m "feat: swapDayAction gains a pick mode for an explicit recipe"
```

---

### Task 3: Component test harness + picker components

**Files:**
- Modify: `vitest.config.ts`
- Modify: `package.json` (devDependencies, via npm)
- Create: `src/app/(app)/PickerPanel.tsx`
- Create: `src/app/(app)/PickerPanel.test.tsx`

**Interfaces:**
- Consumes: `PickerOption` from Task 1 (`@/lib/services/planning`); `swapDayAction` from Task 2 (`@/app/actions/plan`); `DAY_NAMES` from `@/lib/services/dates`.
- Produces:
  ```ts
  export function PickLink(props: { day: number; week: string }): JSX.Element;
  export function PickerPanel(props: {
    day: number; week: string; query: string;
    options: PickerOption[]; dayLabel: string;
  }): JSX.Element;
  ```
  Task 4 imports both from `@/app/(app)/PickerPanel`.

This repo has no component tests yet. This task adds the harness and uses
it on the one piece of UI in this feature that carries real display logic.

- [ ] **Step 1: Install the test dependencies**

```bash
npm i -D @testing-library/react jsdom
```

`@testing-library/react` v16+ supports React 19 (this repo is on 19.2.4).
No `jest-dom` package — plain `expect` assertions keep the dependency
count down.

- [ ] **Step 2: Let vitest see `.tsx` tests**

In `vitest.config.ts`, replace the `include` line:

```ts
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/**/*.test.ts'],
```

Leave `testTimeout` and `maxWorkers` exactly as they are — they exist for
the PGlite suites and are unrelated to this change. Do **not** set a global
`environment`; the DOM tests opt in per file, so the existing node-env
suites are untouched.

- [ ] **Step 3: Write the failing component tests**

Create `src/app/(app)/PickerPanel.test.tsx`:

```tsx
// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { PickerOption } from '@/lib/services/planning';

// next/link wants app-router context a bare render cannot provide, and the
// action module would pull the whole DB layer into a DOM test. Neither is
// what these tests are about.
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock('@/app/actions/plan', () => ({ swapDayAction: '/stub-action' }));

const { PickLink, PickerPanel } = await import('./PickerPanel');

const option = (over: Partial<PickerOption> = {}): PickerOption => ({
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Chicken Katsu',
  cuisine: 'japanese',
  kcal: 712,
  favourite: true,
  plannedDay: null,
  ...over,
});

const panel = (over: Partial<Parameters<typeof PickerPanel>[0]> = {}) =>
  render(
    <PickerPanel
      day={2}
      week=""
      query=""
      dayLabel="Wednesday 15 July"
      options={[option()]}
      {...over}
    />,
  );

describe('PickLink', () => {
  it('links to the picker for its own day and anchors to the panel', () => {
    render(<PickLink day={4} week="" />);
    expect(screen.getByRole('link').getAttribute('href')).toBe('/?pick=4#pick');
  });

  it('keeps the next-week context', () => {
    render(<PickLink day={4} week="next" />);
    expect(screen.getByRole('link').getAttribute('href')).toBe('/?pick=4&week=next#pick');
  });
});

describe('PickerPanel', () => {
  it('names the day it is picking for', () => {
    panel();
    expect(screen.getByRole('heading').textContent).toContain('Wednesday 15 July');
  });

  it('shows each recipe with its cuisine and calories', () => {
    panel({ options: [option({ name: 'Beef Rendang', cuisine: 'indonesian', kcal: 690 })] });
    expect(screen.getByText('Beef Rendang')).toBeDefined();
    const row = screen.getByText('Beef Rendang').closest('li')!;
    expect(within(row).getByText(/indonesian/).textContent).toContain('690 kcal');
  });

  it('marks a recipe already planned this week but still offers it', () => {
    panel({ options: [option({ plannedDay: 1 })] });
    const row = screen.getByText('Chicken Katsu').closest('li')!;
    expect(row.textContent).toContain('already on Tue');
    expect(within(row).getByRole('button').textContent).toBe('Use');
  });

  it('distinguishes AI dinners from favourites', () => {
    panel({ options: [option({ favourite: false })] });
    expect(screen.getByText('Chicken Katsu').closest('li')!.textContent).toContain('from a past plan');
  });

  it('carries the day, week and recipe id so the action knows what to swap', () => {
    panel({ day: 5, week: 'next', options: [option({ id: '22222222-2222-4222-8222-222222222222' })] });
    const form = screen.getByText('Chicken Katsu').closest('li')!.querySelector('form')!;
    const value = (name: string) => form.querySelector<HTMLInputElement>(`input[name="${name}"]`)!.value;
    expect(value('day')).toBe('5');
    expect(value('week')).toBe('next');
    expect(value('mode')).toBe('pick');
    expect(value('recipeId')).toBe('22222222-2222-4222-8222-222222222222');
  });

  it('explains an empty search rather than showing a blank box', () => {
    panel({ query: 'zzz', options: [] });
    expect(screen.getByText(/Nothing matches/).textContent).toContain('zzz');
  });

  it('points an empty library at the Recipes page instead', () => {
    panel({ query: '', options: [] });
    expect(screen.getByText(/No recipes yet/)).toBeDefined();
  });

  it('keeps the current search in the box and the week on the close link', () => {
    panel({ week: 'next', query: 'katsu' });
    expect(screen.getByRole('textbox').getAttribute('value')).toBe('katsu');
    expect(screen.getByText('close').getAttribute('href')).toBe('/?week=next');
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run "src/app/(app)/PickerPanel.test.tsx"`
Expected: FAIL — `./PickerPanel` does not exist.

- [ ] **Step 5: Create the components**

Create `src/app/(app)/PickerPanel.tsx`:

```tsx
import Link from 'next/link';
import { DAY_NAMES } from '@/lib/services/dates';
import { swapDayAction } from '@/app/actions/plan';
import type { PickerOption } from '@/lib/services/planning';

const PILL =
  'rounded-full border border-line px-3 py-1 text-xs text-soft hover:border-bottle hover:text-bottle';

/** Opens the picker panel below the week grid. Navigation only — no JS. */
export function PickLink({ day, week }: { day: number; week: string }) {
  return (
    <Link href={`/?pick=${day}${week === 'next' ? '&week=next' : ''}#pick`} className={PILL}>
      Pick manually
    </Link>
  );
}

/** The manual-pick panel: search, then one row per recipe in the library. */
export function PickerPanel({
  day, week, query, options, dayLabel,
}: {
  day: number; week: string; query: string; options: PickerOption[]; dayLabel: string;
}) {
  const closeHref = week === 'next' ? '/?week=next' : '/';
  return (
    <section id="pick" aria-label="Pick a dinner" className="card p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-[19px]">Pick a dinner for {dayLabel}</h2>
        <Link className="text-xs text-soft hover:text-bottle" href={closeHref}>close</Link>
      </div>

      <form className="mt-3 flex gap-2" action="/">
        <input type="hidden" name="pick" value={day} />
        {week === 'next' && <input type="hidden" name="week" value="next" />}
        <input
          name="q"
          defaultValue={query}
          placeholder="Search by name"
          className="w-full rounded-md border border-line px-2.5 py-1.5 text-sm"
        />
        <button className={PILL}>Search</button>
      </form>

      <p className="eyebrow mt-3">{options.length} {options.length === 1 ? 'recipe' : 'recipes'}</p>

      {options.length === 0 ? (
        <p className="mt-2 text-sm text-soft">
          {query ? `Nothing matches “${query}”.` : 'No recipes yet — add one on the Recipes page.'}
        </p>
      ) : (
        <ul className="mt-1.5 max-h-[320px] divide-y divide-line overflow-y-auto">
          {options.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{o.name}</p>
                <p className="font-data text-[11px] text-soft">
                  {o.cuisine} · {o.kcal} kcal
                  {!o.favourite && ' · from a past plan'}
                  {o.plannedDay !== null && ` · already on ${DAY_NAMES[o.plannedDay]}`}
                </p>
              </div>
              <form action={swapDayAction}>
                <input type="hidden" name="day" value={day} />
                <input type="hidden" name="week" value={week} />
                <input type="hidden" name="mode" value="pick" />
                <input type="hidden" name="recipeId" value={o.id} />
                <button className={PILL}>Use</button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run "src/app/(app)/PickerPanel.test.tsx"`
Expected: PASS, all cases.

- [ ] **Step 7: Run the full suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass (the existing PGlite suites must be unaffected), no type errors.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json vitest.config.ts "src/app/(app)/PickerPanel.tsx" "src/app/(app)/PickerPanel.test.tsx"
git commit -m "feat: picker panel components, with the repo's first component tests"
```

---

### Task 4: Wire the picker into the Plan page

**Files:**
- Modify: `src/app/(app)/page.tsx`

**Interfaces:**
- Consumes: `pickerOptions` from Task 1; `PickLink` and `PickerPanel` from Task 3; the existing `longDay`, `utc` helpers already defined in `page.tsx`.
- Produces: no exports — this is the top-level page.

Verified by typecheck, production build, and a manual pass against the dev
server. The display logic itself is already covered by Task 3's tests.

- [ ] **Step 1: Widen the page's search params**

In `src/app/(app)/page.tsx`, replace the `searchParams` type and destructuring (currently lines 100 and 102):

```tsx
  searchParams: Promise<{
    degraded?: string; planned?: string; week?: string;
    pick?: string; q?: string; error?: string;
  }>;
}) {
  const { degraded, planned, week: weekParam, pick, q, error } = await searchParams;
```

- [ ] **Step 2: Load the picker options**

Immediately after the existing `const week = await getWeek(getDb(), weekStart);` line, add:

```tsx
  // Only 0–6 opens the picker; anything else is ignored rather than trusted.
  const pickDay = pick !== undefined && /^[0-6]$/.test(pick) ? Number(pick) : null;
  const pickQuery = typeof q === 'string' ? q : '';
  const pickList = pickDay === null ? [] : await pickerOptions(getDb(), weekStart, pickQuery);
```

Add the imports at the top of the file:

```tsx
import { getWeek, pickerOptions } from '@/lib/services/planning';
import { PickLink, PickerPanel } from './PickerPanel';
```

(the first line replaces the existing `import { getWeek } from '@/lib/services/planning';`)

- [ ] **Step 3: Add the "Pick manually" link to `SwapButtons`**

In the existing `SwapButtons` component, add the imported `PickLink` as the
last child of its wrapper `<div>`, directly after the `.map(...)` block that
renders the three swap forms:

```tsx
      ))}
      <PickLink day={day} week={week} />
    </div>
```

Leave the three existing swap forms exactly as they are.

- [ ] **Step 4: Give empty days a "Pick manually" link**

In the week grid, replace the empty-day branch (currently `<p className="my-auto text-[13px] text-soft">Nothing planned</p>`) with:

```tsx
                  <div className="my-auto space-y-1.5">
                    <p className="text-[13px] text-soft">Nothing planned</p>
                    <PickLink day={day} week={weekRaw} />
                  </div>
```

- [ ] **Step 5: Render the panel and the error notice**

Directly after the closing `</section>` of the "Week at a glance" section, add:

```tsx
      {pickDay !== null && (
        <PickerPanel
          day={pickDay}
          week={weekRaw}
          query={pickQuery}
          options={pickList}
          dayLabel={longDay(utc(weekStart, pickDay))}
        />
      )}
```

And alongside the existing `degraded` / `planned` notices, add:

```tsx
      {error === 'gone' && (
        <p className="card border-dijon bg-dijon-soft p-3 text-sm">
          That recipe was removed before the swap went through — nothing changed.
        </p>
      )}
```

- [ ] **Step 6: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: no type errors; the build completes and lists `/` as dynamic.

- [ ] **Step 7: Manual verification**

Run `npm run dev` (needs `.env.local`) and confirm:

1. Every planned day's "more" disclosure shows a **Pick manually** link; clicking it opens one panel below the grid and jumps to it.
2. Only one panel opens when picking **today**, which renders in both the "tonight" hero and the grid.
3. Searching filters the list and keeps the panel open; clearing the box and searching again restores the full list.
4. A recipe already on another night shows "already on <Day>" and its **Use** button still works.
5. Choosing a recipe swaps that day and closes the panel; the shopping list for that week is invalidated (per `swapDay`).
6. A day with no dinner shows **Pick manually**, and picking fills the gap.
7. The `next` week tab keeps `week=next` through opening the picker, searching, and picking.

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add "src/app/(app)/page.tsx"
git commit -m "feat: pick a specific recipe for a day from the Plan page"
```

---

## Self-Review

**Spec coverage**

| Spec requirement | Task |
| --- | --- |
| Whole library, favourites + AI | 1 (`pickerOptions` selects all recipes) |
| Favourites first, newest-first within group | 1 (stable sort) |
| Case-insensitive name search, blank query is a no-op | 1 |
| `plannedDay` scoped to this week only | 1 |
| Picker must not create a week plan row | 1 |
| `pick` mode routes to `{ recipeId }` | 2 |
| Malformed-id guard reusing `UUID_RE` | 2 |
| `{ ok: false }` surfaced as `?error=` | 2 (action) + 4 (notice) |
| Redirect drops `pick` / `q` so the panel closes | 2 |
| Single full-width panel beneath the grid, `id="pick"` | 3 (component) + 4 (rendered once) |
| GET search form, hidden `pick` / `week` | 3 |
| Scrolling list, result count, empty state | 3 |
| "already on <Day>" marker, still pickable | 3 |
| "Pick manually" on empty days | 4 (Step 4) |
| No new route, no client JS, no schema change | all |

**Placeholder scan:** none — every step carries the literal code or command to run.

**Type consistency:** `PickerOption` is defined once in Task 1 and imported by name in Task 3. `pickerOptions(db, weekStart, query?)` is called with exactly that shape in Task 4 Step 2. `swapDay(..., { recipeId })` matches the existing signature verified in Task 2 Step 2. `PickLink` and `PickerPanel` are defined in Task 3 and imported from `./PickerPanel` in Task 4 — the page no longer declares them. `PickerPanel` takes `dayLabel` (built at the call site with the page's existing `longDay(utc(weekStart, day))` helpers, giving the spec's long day name) while the row markers use the short `DAY_NAMES` array, imported by `PickerPanel.tsx` itself.

**Deviation from the spec, authorised 2026-08-02:** the spec's testing section
assumed no component tests were possible. Task 3 adds the harness
(`@testing-library/react` + `jsdom`, `.test.tsx` in the vitest include) and
covers the picker's display logic directly, so Task 4's manual checklist now
backs up real assertions rather than standing alone.
