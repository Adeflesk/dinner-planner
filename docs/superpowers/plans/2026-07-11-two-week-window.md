# Two-Week Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the household view and act on two weeks — the current one and the next — selected via `?week=next` in the URL, so planning ahead works and Monday rollover stops looking like a broken app.

**Architecture:** Two pure date helpers (`nextWeekStart`, `resolveWeekStart`) become the single trust boundary: every week-scoped server action re-resolves the week from the raw form value, so only two Mondays are ever reachable. The Plan and Shopping pages read `?week=` from `searchParams`, render a two-tab toggle, and thread the raw param through hidden `week` inputs on every week-scoped form. No schema, service-signature, or macro/planner changes — the services are already week-keyed.

**Tech Stack:** Next.js App Router (server components + server actions), TypeScript, Vitest. No client JS.

## Global Constraints

- **Exactly two legal weeks:** `resolveWeekStart(param)` returns `nextWeekStart()` only for the literal string `'next'`; every other input (undefined, garbage, hand-typed dates) returns `currentWeekStart()`. No error states for bad params.
- **Trust boundary:** every week-scoped action re-resolves from the raw form value with `resolveWeekStart` — never trust a date string from the client.
- **Week convention (existing):** Monday `YYYY-MM-DD` in UTC; day indexing 0 = Monday … 6 = Sunday.
- **Tonight hero and `today` rail highlight appear ONLY when viewing the current week.**
- **No schema changes, no service-signature changes, no client JS.** UI layer is verified by `npx tsc --noEmit` + `npm run build` per repo convention.
- Redirects out of `planMyWeek` preserve the week: append `&week=next` when the acted-on week is next week.
- `toggleItemAction` / `addItemAction` / `removeItemAction` are list-id-scoped and need **no** week field.

## File Structure

- **Modify** `src/lib/services/dates.ts` — add `nextWeekStart`, `resolveWeekStart` (pure).
- **Modify** `src/lib/services/dates.test.ts` — unit tests for both.
- **Modify** `src/lib/services/planning.test.ts` — integration regression guard: two weeks coexist.
- **Create** `src/app/(app)/WeekTabs.tsx` — shared server component: the This week · Next week toggle.
- **Modify** `src/app/actions/plan.ts` — `planMyWeek`/`swapDayAction`/`togglePinAction` read `week` from FormData.
- **Modify** `src/app/(app)/page.tsx` — week param, toggle, conditional hero/today, hidden inputs.
- **Modify** `src/app/actions/shopping.ts` — `buildListAction` reads `week` from FormData.
- **Modify** `src/app/(app)/shopping/page.tsx` — week param, toggle, hidden inputs, week-preserving links.

---

### Task 1: Pure date helpers

**Files:**
- Modify: `src/lib/services/dates.ts`
- Test: `src/lib/services/dates.test.ts`

**Interfaces:**
- Consumes: existing `currentWeekStart(now?: Date): string`.
- Produces: `nextWeekStart(now?: Date): string` and `resolveWeekStart(param: string | undefined, now?: Date): string` — both return `YYYY-MM-DD` Monday strings. Later tasks import both from `@/lib/services/dates`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/services/dates.test.ts` (and extend the import):

```ts
import { currentWeekStart, nextWeekStart, resolveWeekStart } from './dates';
```

```ts
describe('nextWeekStart', () => {
  it('returns the Monday after the current week', () => {
    expect(nextWeekStart(new Date('2026-07-08T10:00:00Z'))).toBe('2026-07-13'); // Wed → next Mon
    expect(nextWeekStart(new Date('2026-07-06T00:00:00Z'))).toBe('2026-07-13'); // Mon → next Mon
    expect(nextWeekStart(new Date('2026-07-12T23:00:00Z'))).toBe('2026-07-13'); // Sun → tomorrow
  });
  it('crosses year boundaries correctly', () => {
    expect(nextWeekStart(new Date('2026-12-31T12:00:00Z'))).toBe('2027-01-04'); // Thu → Mon in new year
  });
});

describe('resolveWeekStart', () => {
  const now = new Date('2026-07-08T10:00:00Z'); // Wed; current week 2026-07-06
  it("maps 'next' to next week's Monday", () => {
    expect(resolveWeekStart('next', now)).toBe('2026-07-13');
  });
  it('maps undefined to the current week', () => {
    expect(resolveWeekStart(undefined, now)).toBe('2026-07-06');
  });
  it('maps garbage and hand-typed dates to the current week', () => {
    expect(resolveWeekStart('2031-01-06', now)).toBe('2026-07-06');
    expect(resolveWeekStart('lol', now)).toBe('2026-07-06');
    expect(resolveWeekStart('', now)).toBe('2026-07-06');
    expect(resolveWeekStart('null', now)).toBe('2026-07-06');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/services/dates.test.ts`
Expected: FAIL — `nextWeekStart` / `resolveWeekStart` are not exported.

- [ ] **Step 3: Implement the helpers**

Append to `src/lib/services/dates.ts`:

```ts
/** Monday (YYYY-MM-DD, UTC) of the week AFTER the one containing `now`. */
export function nextWeekStart(now: Date = new Date()): string {
  const d = new Date(`${currentWeekStart(now)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10);
}

/**
 * Trust boundary for the two-week window: the raw `?week=` value (from a URL
 * or a form field) resolves to exactly one of two legal Mondays. Only the
 * literal 'next' selects next week; anything else is the current week, so a
 * crafted request can never create week rows at arbitrary dates.
 */
export function resolveWeekStart(param: string | undefined, now: Date = new Date()): string {
  return param === 'next' ? nextWeekStart(now) : currentWeekStart(now);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/services/dates.test.ts`
Expected: PASS (all, including pre-existing `currentWeekStart` cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/dates.ts src/lib/services/dates.test.ts
git commit -m "feat: nextWeekStart and resolveWeekStart date helpers"
```

---

### Task 2: Regression guard — two weeks coexist

**Files:**
- Test: `src/lib/services/planning.test.ts`

**Interfaces:**
- Consumes: existing `planWeek(db, weekStart, gen)` from `./planning`, `buildList(db, weekStart, lowStapleNames)` from `./shopping`, and this file's existing `adult` fixture and `makeAi` generator factory.
- Produces: nothing — this is a characterization test locking in that the week-keyed services already isolate weeks. **It is expected to pass immediately** (no production code changes in this task); its job is to fail loudly if Tasks 3–4 or any future change breaks week isolation.

- [ ] **Step 1: Write the test**

Append to `src/lib/services/planning.test.ts` (the file already imports `createTestDb`, `people`, `settings`, `plannedDinners`, `planWeek`, and defines `adult` and `makeAi`; add `buildList` and `getList` to the imports from `./shopping`):

```ts
import { buildList, getList } from './shopping';
```

```ts
describe('two-week window', () => {
  it('this week and next week plan and shop independently', async () => {
    const db = await createTestDb();
    await db.insert(people).values(adult);
    await db.insert(settings).values({ id: 1, cuisines: ['italian'], equipment: [] });

    await planWeek(db, '2026-07-06', makeAi([]));
    await planWeek(db, '2026-07-13', makeAi([]));

    const dinners = await db.select().from(plannedDinners);
    expect(dinners.length).toBeGreaterThan(7); // two separate weeks of dinners

    const thisList = (await buildList(db, '2026-07-06', []))!;
    const nextList = (await buildList(db, '2026-07-13', []))!;
    expect(thisList.id).not.toBe(nextList.id);

    // Re-planning NEXT week invalidates only next week's list.
    await planWeek(db, '2026-07-13', makeAi([]));
    expect(await getList(db, '2026-07-06')).not.toBeNull();
    expect(await getList(db, '2026-07-13')).toBeNull();
  });
});
```

- [ ] **Step 2: Run and confirm it passes (characterization, not TDD-red)**

Run: `npx vitest run src/lib/services/planning.test.ts`
Expected: PASS. If it FAILS, stop — that means week isolation is already broken and the spec's foundation is wrong; escalate rather than patching.

- [ ] **Step 3: Commit**

```bash
git add src/lib/services/planning.test.ts
git commit -m "test: lock in week isolation for planning and shopping lists"
```

---

### Task 3: Week toggle component, plan actions, plan page

**Files:**
- Create: `src/app/(app)/WeekTabs.tsx`
- Modify: `src/app/actions/plan.ts`
- Modify: `src/app/(app)/page.tsx`

**Interfaces:**
- Consumes: `resolveWeekStart`, `nextWeekStart`, `currentWeekStart` from `@/lib/services/dates` (Task 1 signatures).
- Produces: `WeekTabs` server component with props `{ basePath: string; isNext: boolean }` — Task 4's shopping page reuses it verbatim. Plan actions now read an optional `week` form field; forms without one keep working (resolve to current week).

- [ ] **Step 1: Create the shared toggle component**

```tsx
// src/app/(app)/WeekTabs.tsx
import Link from 'next/link';

/** This week · Next week toggle. Pure links — week state lives in the URL. */
export function WeekTabs({ basePath, isNext }: { basePath: string; isNext: boolean }) {
  const tab = (active: boolean) =>
    `eyebrow pb-0.5 ${active ? 'border-b-2 border-dijon text-ink' : 'hover:text-ink'}`;
  return (
    <nav aria-label="Week" className="flex gap-4">
      <Link href={basePath} className={tab(!isNext)}>This week</Link>
      <Link href={`${basePath}?week=next`} className={tab(isNext)}>Next week</Link>
    </nav>
  );
}
```

- [ ] **Step 2: Thread the week through the plan actions**

Replace the body of `src/app/actions/plan.ts` with:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db';
import { resolveWeekStart } from '@/lib/services/dates';
import { planWeek, swapDay, togglePin } from '@/lib/services/planning';

// Trust boundary: actions re-resolve the week from the raw form value, so the
// client can only ever act on the current or next week (see resolveWeekStart).
const weekFrom = (formData: FormData) => {
  const raw = formData.get('week');
  return {
    weekStart: resolveWeekStart(typeof raw === 'string' ? raw : undefined),
    isNext: raw === 'next',
  };
};

export async function planMyWeek(formData: FormData) {
  const { weekStart, isNext } = weekFrom(formData);
  const { aiDegraded } = await planWeek(getDb(), weekStart);
  revalidatePath('/');
  const wk = isNext ? '&week=next' : '';
  redirect(aiDegraded ? `/?degraded=1${wk}` : `/?planned=1${wk}`);
}

const SWAP_MODES = ['favourite', 'ai', 'ai-same-cuisine'] as const;
type SwapMode = typeof SWAP_MODES[number];

export async function swapDayAction(formData: FormData) {
  const day = Number(formData.get('day'));
  const raw = String(formData.get('mode'));
  if (!SWAP_MODES.includes(raw as SwapMode)) return;
  await swapDay(getDb(), weekFrom(formData).weekStart, day, raw as SwapMode);
  revalidatePath('/');
}

export async function togglePinAction(formData: FormData) {
  await togglePin(getDb(), weekFrom(formData).weekStart, Number(formData.get('day')));
  revalidatePath('/');
}
```

- [ ] **Step 3: Rework the plan page**

In `src/app/(app)/page.tsx`, make these exact edits:

3a. Imports — add `resolveWeekStart` and `WeekTabs`:

```ts
import { currentWeekStart, DAY_NAMES, resolveWeekStart } from '@/lib/services/dates';
import { WeekTabs } from './WeekTabs';
```

3b. `SwapButtons` gains a `week` prop (hidden input added; everything else unchanged):

```tsx
function SwapButtons({ day, cuisine, week }: { day: number; cuisine: string; week: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {(['favourite', 'ai', 'ai-same-cuisine'] as const).map((mode) => (
        <form key={mode} action={swapDayAction}>
          <input type="hidden" name="day" value={day} />
          <input type="hidden" name="mode" value={mode} />
          <input type="hidden" name="week" value={week} />
          <button className="rounded-full border border-line px-3 py-1 text-xs text-soft hover:border-bottle hover:text-bottle">
            {mode === 'favourite' ? 'Another favourite' : mode === 'ai' ? 'New idea' : `More ${cuisine}`}
          </button>
        </form>
      ))}
    </div>
  );
}
```

3c. `PinButton` gains a `week` prop the same way:

```tsx
function PinButton({ day, pinned, week }: { day: number; pinned: boolean; week: string }) {
  return (
    <form action={togglePinAction}>
      <input type="hidden" name="day" value={day} />
      <input type="hidden" name="week" value={week} />
      <button
        title={pinned ? 'Unpin' : 'Pin (survives re-plan)'}
        className={`font-data text-[11px] ${pinned ? 'text-bottle' : 'text-soft hover:text-ink'}`}
      >
        {pinned ? 'pinned ●' : 'pin'}
      </button>
    </form>
  );
}
```

3d. Page setup — accept the param and derive the three values every render decision uses:

```tsx
export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ degraded?: string; planned?: string; week?: string }>;
}) {
  const { degraded, planned, week: weekParam } = await searchParams;
  const isNext = weekParam === 'next';
  const weekRaw = isNext ? 'next' : '';           // hidden-input value; '' resolves to current
  const weekStart = resolveWeekStart(isNext ? 'next' : undefined);
  const week = await getWeek(getDb(), weekStart);
  const personName = (id: string) => week.people.find((p) => p.id === id)?.name ?? '?';

  const todayIdx = (new Date().getUTCDay() + 6) % 7;
  const tonight = isNext ? undefined : week.dinners.find((d) => d.day === todayIdx);
```

(The `fill` helper and everything else in setup stays as is.)

3e. Header block — add the tabs and thread the week into the plan form and shopping link:

```tsx
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[27px]">Week of {longDay(utc(weekStart)).replace(/^\w+ /, '')}</h1>
          <p className="eyebrow mt-1">{shortDate(utc(weekStart))} — {shortDate(utc(weekStart, 6))}</p>
          <div className="mt-2.5"><WeekTabs basePath="/" isNext={isNext} /></div>
        </div>
        <div className="flex gap-2.5">
          <form action={planMyWeek}>
            <input type="hidden" name="week" value={weekRaw} />
            <button className="btn btn-primary">
              {week.dinners.length ? 'Re-plan week' : 'Plan my week'}
            </button>
          </form>
          <Link href={isNext ? '/shopping?week=next' : '/shopping'} className="btn btn-ghost">Shopping list →</Link>
        </div>
      </div>
```

3f. The planned banner links to the same week's list:

```tsx
      {planned && (
        <p className="card border-bottle bg-bottle-soft p-3 text-sm">
          Week planned — <Link className="font-medium underline underline-offset-3" href={isNext ? '/shopping?week=next' : '/shopping'}>build your shopping list →</Link>
        </p>
      )}
```

3g. The Tonight section renders only on the current week. Wrap the existing `<section aria-label="Tonight">…</section>` in `{!isNext && ( … )}`. Inside it, `tonight` is already `undefined` on next week (3d), but the whole section must be omitted — the eyebrow says "Tonight", which is false for a future week. Pass the new props at the two existing call sites inside the hero: `<PinButton day={todayIdx} pinned={tonight.pinned} week={weekRaw} />` and `<SwapButtons day={todayIdx} cuisine={tonight.recipe.cuisine} week={weekRaw} />`.

3h. In the week rail: `const today = !isNext && day === todayIdx;` (replaces `const today = day === todayIdx;`), and pass `week={weekRaw}` to the rail's `PinButton` and `SwapButtons` call sites.

- [ ] **Step 4: Verify types and build**

Run: `npx tsc --noEmit && npm run build`
Expected: both clean (a pre-existing `.next/dev/types` tsc error, if present, is the only ignorable one).

- [ ] **Step 5: Manual verification**

Run `npm run dev`, open `/`:
- Current week unchanged, tabs visible, "This week" active.
- Click "Next week" → URL `/?week=next`, no Tonight hero, no `today` card highlight, heading shows next Monday's date.
- "Plan my week" on next week plans NEXT week (heading dates confirm), redirect keeps `?week=next`.

- [ ] **Step 6: Commit**

```bash
git add 'src/app/(app)/WeekTabs.tsx' src/app/actions/plan.ts 'src/app/(app)/page.tsx'
git commit -m "feat: plan page gains a this-week/next-week window"
```

---

### Task 4: Shopping page + build action, final verification

**Files:**
- Modify: `src/app/actions/shopping.ts`
- Modify: `src/app/(app)/shopping/page.tsx`

**Interfaces:**
- Consumes: `resolveWeekStart` from `@/lib/services/dates` (Task 1) and `WeekTabs` with props `{ basePath: string; isNext: boolean }` (Task 3).
- Produces: nothing new.

- [ ] **Step 1: Thread the week through `buildListAction`**

In `src/app/actions/shopping.ts`, replace the import of `currentWeekStart` and the `buildListAction` body (the three list-id-scoped actions are untouched):

```ts
import { resolveWeekStart } from '@/lib/services/dates';
```

```ts
export async function buildListAction(formData: FormData) {
  const low = formData.getAll('lowStaple').map(String);
  const raw = formData.get('week');
  await buildList(getDb(), resolveWeekStart(typeof raw === 'string' ? raw : undefined), low);
  revalidatePath('/shopping');
}
```

- [ ] **Step 2: Rework the shopping page**

In `src/app/(app)/shopping/page.tsx`, make these exact edits:

2a. Imports:

```ts
import { resolveWeekStart } from '@/lib/services/dates';
import { WeekTabs } from '../WeekTabs';
```

(`currentWeekStart` is no longer imported.)

2b. Signature + setup:

```tsx
export default async function ShoppingPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week: weekParam } = await searchParams;
  const isNext = weekParam === 'next';
  const weekRaw = isNext ? 'next' : '';
  const db = getDb();
  const weekStart = resolveWeekStart(isNext ? 'next' : undefined);
  const list = await getList(db, weekStart);
```

2c. "No dinners" empty state — add tabs and a week-preserving plan link:

```tsx
      return (
        <main className="mx-auto w-full max-w-lg space-y-4">
          <div>
            <h1 className="font-display text-[27px]">Shopping list</h1>
            <p className="eyebrow mt-1">Week of {weekStart}</p>
            <div className="mt-2.5"><WeekTabs basePath="/shopping" isNext={isNext} /></div>
          </div>
          <p className="card p-4 text-sm">
            No dinners planned yet — <Link href={isNext ? '/?week=next' : '/'} className="text-bottle underline underline-offset-3">plan your week first</Link>,
            then build the list from it.
          </p>
        </main>
      );
```

2d. Staples-check screen — add tabs to the header div and the hidden week input to the build form:

```tsx
        <div>
          <h1 className="font-display text-[27px]">Shopping list</h1>
          <p className="eyebrow mt-1">Week of {weekStart}</p>
          <div className="mt-2.5"><WeekTabs basePath="/shopping" isNext={isNext} /></div>
        </div>
        <form action={buildListAction} className="card space-y-4 border-t-[3px] border-t-bottle p-5 text-sm">
          <input type="hidden" name="week" value={weekRaw} />
```

(rest of the form unchanged)

2e. Built-list screen — tabs in the header block, hidden week input in the Rebuild form:

```tsx
        <div>
          <h1 className="font-display text-[27px]">Shopping</h1>
          <p className="eyebrow mt-1">
            Week of {weekStart} · <span className="text-bottle">{remaining} to get</span>
          </p>
          <div className="mt-2.5"><WeekTabs basePath="/shopping" isNext={isNext} /></div>
        </div>
        <form action={buildListAction}>
          <input type="hidden" name="week" value={weekRaw} />
          <button className="btn btn-ghost">Rebuild</button>
        </form>
```

(The tick/add/remove forms are list-id-scoped — no week input.)

- [ ] **Step 3: Verify types, build, and the full suite**

Run: `npx tsc --noEmit && npm run build && npm test`
Expected: all clean/green (116 + the new tests from Tasks 1–2).

- [ ] **Step 4: Manual verification**

`npm run dev`:
- `/shopping` unchanged for the current week; tabs present.
- `/shopping?week=next` with next week unplanned → "No dinners planned yet" with a link to `/?week=next`.
- Plan next week on `/?week=next`, then `/shopping?week=next` → staples check → Build → list for next Monday's date. Tick an item; confirm this week's list (if any) is untouched on the "This week" tab.

- [ ] **Step 5: Commit**

```bash
git add src/app/actions/shopping.ts 'src/app/(app)/shopping/page.tsx'
git commit -m "feat: shopping list gains the two-week window"
```

---

## Self-Review

**Spec coverage:** week resolution + trust boundary → Task 1 (helpers, garbage-fallback tests) and Tasks 3–4 (every week-scoped action re-resolves). Toggle UI both pages → `WeekTabs` (Task 3) used in Tasks 3–4. Hero/today only on current week → Task 3 steps 3d/3g/3h. Redirect preserves week → Task 3 step 2. Week-preserving links (shopping link, planned banner, plan-first link) → Tasks 3e/3f/4-2c. List-id-scoped actions untouched → Task 4 step 1 note. Integration test (two weeks coexist, re-plan isolation) → Task 2. Non-goals respected: no schema/service changes anywhere, no client JS (toggle is links), no past weeks.

**Placeholder scan:** clean — every step has exact code.

**Type consistency:** `resolveWeekStart(param: string | undefined, now?: Date)` used identically in actions (Tasks 3–4) and pages; `WeekTabs { basePath: string; isNext: boolean }` matches both call sites; `SwapButtons`/`PinButton` `week: string` props match all four call sites (hero + rail); `weekRaw` is `'' | 'next'` everywhere and `''` resolves to current week by the helper's contract.
