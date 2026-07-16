# Mark-as-Staple from the Shopping List — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One tap on a shopping-list row marks the item as a pantry staple (added to `pantry_staples`, removed from the current list) with an inline Undo notice that restores everything.

**Architecture:** Two new service functions in `src/lib/services/shopping.ts` following the existing `removeItem` pattern, plus a pure base64url undo-payload codec in the same file. Two thin server actions redirect back to the shopping page carrying the undo payload in the URL (`?undo=…`); the page decodes it to render the notice. No schema change, no client JS.

**Tech Stack:** Next.js App Router server actions + server components, Drizzle ORM, Vitest with PGlite (`createTestDb` from `@/lib/test/db`).

**Spec:** `docs/superpowers/specs/2026-07-16-mark-as-staple-design.md`

## Global Constraints

- No schema change — `pantry_staples` (id + unique name) is used as-is. Nothing to `db:generate`/`db:push`.
- No client-side JS — plain forms + redirect, like every other list action.
- Notice copy, verbatim: `Marked {name} as a pantry staple — it won't appear on future lists.` with an `Undo` button.
- Button accessible label, verbatim: `Mark {name} as a pantry staple`.
- Rows whose **canonical** name is already in `pantry_staples` show no staple button (compare via `canonicalName` from `@/lib/macro/canon`).
- The `week` form field follows the two-week-window contract: raw value `'next'` or empty string; redirects preserve `week=next` only when the raw value is `'next'`.
- Services take a `Db` parameter; actions are thin (`FormData` → service with `getDb()` → `revalidatePath` → `redirect`). No business logic in `src/app/`.

---

### Task 1: `markItemStaple` service

**Files:**
- Modify: `src/lib/services/shopping.ts` (add one function at the end of the file)
- Test: `src/lib/services/shopping.test.ts` (add one `describe` block)

**Interfaces:**
- Consumes: existing `shoppingLists`, `pantryStaples` tables from `@/lib/db/schema`; existing `buildList`, `addItem` services; `seedWeek` helper already in the test file (plants staple `'olive oil'` + ingredient `'chicken breast'` in week `'2026-06-29'`, exported as const `WEEK`).
- Produces: `markItemStaple(db: Db, listId: string, index: number): Promise<StoredShoppingItem | null>` — inserts the item's name into `pantry_staples` (conflict no-op), removes the item from the list, returns the removed item; `null` (no changes) when the list or index is missing.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/services/shopping.test.ts`. Extend the existing import from `./shopping` (line 6) with `markItemStaple`, and add `shoppingLists` to the schema import (line 5). Then append:

```ts
describe('markItemStaple', () => {
  it('inserts the staple, removes exactly that item, and returns it', async () => {
    const db = await createTestDb();
    await seedWeek(db);
    const list = (await buildList(db, WEEK, []))!;
    const idx = list.items.findIndex((i) => i.name === 'chicken breast');

    const removed = await markItemStaple(db, list.id, idx);

    expect(removed?.name).toBe('chicken breast');
    const staples = await db.select().from(pantryStaples);
    expect(staples.map((s) => s.name)).toContain('chicken breast');
    const [after] = await db.select().from(shoppingLists).where(eq(shoppingLists.id, list.id));
    expect(after.items.map((i) => i.name)).not.toContain('chicken breast');
    expect(after.items).toHaveLength(list.items.length - 1);
  });

  it('a subsequent buildList excludes the marked ingredient from derived items', async () => {
    const db = await createTestDb();
    await seedWeek(db);
    const list = (await buildList(db, WEEK, []))!;
    const idx = list.items.findIndex((i) => i.name === 'chicken breast');
    await markItemStaple(db, list.id, idx);

    const rebuilt = (await buildList(db, WEEK, []))!;
    expect(rebuilt.items.map((i) => i.name)).not.toContain('chicken breast');
  });

  it('marking an item whose name is already a staple removes it without error', async () => {
    const db = await createTestDb();
    await seedWeek(db);
    // olive oil is already a staple; ticking it low puts it on the list.
    const list = (await buildList(db, WEEK, ['olive oil']))!;
    const idx = list.items.findIndex((i) => i.name.toLowerCase() === 'olive oil');
    expect(idx).toBeGreaterThanOrEqual(0);

    const removed = await markItemStaple(db, list.id, idx);

    expect(removed?.name.toLowerCase()).toBe('olive oil');
    const staples = await db.select().from(pantryStaples);
    expect(staples.filter((s) => s.name.toLowerCase() === 'olive oil')).toHaveLength(1);
    const [after] = await db.select().from(shoppingLists).where(eq(shoppingLists.id, list.id));
    expect(after.items.map((i) => i.name.toLowerCase())).not.toContain('olive oil');
  });

  it('out-of-range index and unknown list id leave everything unchanged', async () => {
    const db = await createTestDb();
    await seedWeek(db);
    const list = (await buildList(db, WEEK, []))!;

    expect(await markItemStaple(db, list.id, 99)).toBeNull();
    expect(await markItemStaple(db, '00000000-0000-0000-0000-000000000000', 0)).toBeNull();

    const [after] = await db.select().from(shoppingLists).where(eq(shoppingLists.id, list.id));
    expect(after.items).toEqual(list.items);
    const staples = await db.select().from(pantryStaples);
    expect(staples).toHaveLength(1); // only the seeded olive oil
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/services/shopping.test.ts`
Expected: FAIL — `markItemStaple` is not exported (`SyntaxError` / "does not provide an export named 'markItemStaple'").

- [ ] **Step 3: Write the implementation**

Append to `src/lib/services/shopping.ts`:

```ts
/**
 * One-tap "this is a pantry staple": records the name and drops the item
 * from the current list. Returns the removed item so the caller can offer undo.
 */
export async function markItemStaple(db: Db, listId: string, index: number) {
  const [list] = await db.select().from(shoppingLists).where(eq(shoppingLists.id, listId));
  const item = list?.items[index];
  if (!list || !item) return null;
  await db.insert(pantryStaples).values({ name: item.name }).onConflictDoNothing();
  const items = list.items.filter((_, i) => i !== index);
  await db.update(shoppingLists).set({ items }).where(eq(shoppingLists.id, listId));
  return item;
}
```

(`pantryStaples` is already imported at the top of the file.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/services/shopping.test.ts`
Expected: PASS (all pre-existing tests plus the 4 new ones).

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/shopping.ts src/lib/services/shopping.test.ts
git commit -m "feat: markItemStaple service — one tap records a staple and drops the item"
```

---

### Task 2: `undoMarkStaple` service + undo-payload codec

**Files:**
- Modify: `src/lib/services/shopping.ts` (add two functions and a type + codec at the end)
- Test: `src/lib/services/shopping.test.ts` (add two `describe` blocks)

**Interfaces:**
- Consumes: `markItemStaple` from Task 1; existing `addItem`, `toggleItem`, `buildList` services.
- Produces:
  - `undoMarkStaple(db: Db, listId: string, name: string, item: StoredShoppingItem): Promise<void>` — deletes the staple row matching `name`, appends `item` back to the list. Each half no-ops independently if its target is gone.
  - `type StapleUndo = { name: string; item: StoredShoppingItem }`
  - `encodeStapleUndo(undo: StapleUndo): string` — base64url JSON.
  - `decodeStapleUndo(raw: string): StapleUndo | null` — `null` on any parse/shape failure, never throws.

- [ ] **Step 1: Write the failing tests**

Extend the `./shopping` import in the test file with `undoMarkStaple, encodeStapleUndo, decodeStapleUndo`, then append:

```ts
describe('undoMarkStaple', () => {
  it('restores the item with manual and checked preserved, and deletes the staple', async () => {
    const db = await createTestDb();
    await seedWeek(db);
    const list = (await buildList(db, WEEK, []))!;
    await addItem(db, list.id, 'ketchup');
    let [state] = await db.select().from(shoppingLists).where(eq(shoppingLists.id, list.id));
    const idx = state.items.findIndex((i) => i.name === 'ketchup');
    await toggleItem(db, list.id, idx); // checked: true
    const removed = (await markItemStaple(db, list.id, idx))!;

    await undoMarkStaple(db, list.id, removed.name, removed);

    [state] = await db.select().from(shoppingLists).where(eq(shoppingLists.id, list.id));
    const ketchup = state.items.find((i) => i.name === 'ketchup');
    expect(ketchup).toMatchObject({ manual: true, checked: true });
    const staples = await db.select().from(pantryStaples);
    expect(staples.map((s) => s.name)).not.toContain('ketchup');
  });

  it('a buildList after undo derives the ingredient again', async () => {
    const db = await createTestDb();
    await seedWeek(db);
    const list = (await buildList(db, WEEK, []))!;
    const idx = list.items.findIndex((i) => i.name === 'chicken breast');
    const removed = (await markItemStaple(db, list.id, idx))!;

    await undoMarkStaple(db, list.id, removed.name, removed);

    const rebuilt = (await buildList(db, WEEK, []))!;
    expect(rebuilt.items.map((i) => i.name)).toContain('chicken breast');
  });

  it('no-ops independently when the staple or list is already gone', async () => {
    const db = await createTestDb();
    await seedWeek(db);
    const list = (await buildList(db, WEEK, []))!;
    const item = list.items[0];

    // Unknown list: staple deletion still runs, list append no-ops, no throw.
    await undoMarkStaple(db, '00000000-0000-0000-0000-000000000000', 'olive oil', item);
    expect((await db.select().from(pantryStaples)).map((s) => s.name)).not.toContain('olive oil');

    // Staple already gone: item is still appended, no throw.
    await undoMarkStaple(db, list.id, 'olive oil', item);
    const [after] = await db.select().from(shoppingLists).where(eq(shoppingLists.id, list.id));
    expect(after.items).toHaveLength(list.items.length + 1);
  });
});

describe('staple undo codec', () => {
  it('round-trips a payload', () => {
    const undo = {
      name: 'chicken breast',
      item: { name: 'chicken breast', quantity: 500, unit: 'g', section: 'meat_fish' as const, checked: true, manual: false },
    };
    expect(decodeStapleUndo(encodeStapleUndo(undo))).toEqual(undo);
  });

  it('returns null for garbage, valid-JSON-wrong-shape, and empty input', () => {
    expect(decodeStapleUndo('not-base64-json')).toBeNull();
    expect(decodeStapleUndo(Buffer.from('{"nope":1}').toString('base64url'))).toBeNull();
    expect(decodeStapleUndo('')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/services/shopping.test.ts`
Expected: FAIL — missing exports `undoMarkStaple` / `encodeStapleUndo` / `decodeStapleUndo`.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/services/shopping.ts`:

```ts
/** Reverses markItemStaple: forgets the staple and puts the item back. */
export async function undoMarkStaple(db: Db, listId: string, name: string, item: StoredShoppingItem) {
  await db.delete(pantryStaples).where(eq(pantryStaples.name, name));
  const [list] = await db.select().from(shoppingLists).where(eq(shoppingLists.id, listId));
  if (!list) return;
  await db.update(shoppingLists).set({ items: [...list.items, item] }).where(eq(shoppingLists.id, listId));
}

/** Undo state carried in the ?undo= search param — same-visit affordance, not durable. */
export type StapleUndo = { name: string; item: StoredShoppingItem };

export function encodeStapleUndo(undo: StapleUndo): string {
  return Buffer.from(JSON.stringify(undo), 'utf8').toString('base64url');
}

export function decodeStapleUndo(raw: string): StapleUndo | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (
      typeof parsed?.name !== 'string'
      || typeof parsed?.item?.name !== 'string'
      || typeof parsed.item.quantity !== 'number'
      || typeof parsed.item.unit !== 'string'
      || typeof parsed.item.section !== 'string'
      || typeof parsed.item.checked !== 'boolean'
      || typeof parsed.item.manual !== 'boolean'
    ) return null;
    return parsed as StapleUndo;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/services/shopping.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/shopping.ts src/lib/services/shopping.test.ts
git commit -m "feat: undoMarkStaple service and base64url undo-payload codec"
```

---

### Task 3: server actions + shopping page UI

**Files:**
- Modify: `src/lib/services/shopping.ts` (add `stapleNameSet`)
- Modify: `src/app/actions/shopping.ts` (add two actions)
- Modify: `src/app/(app)/shopping/page.tsx` (staple button per row, undo notice)
- Test: `src/lib/services/shopping.test.ts` (one test for `stapleNameSet`)

**Interfaces:**
- Consumes: `markItemStaple`, `undoMarkStaple`, `encodeStapleUndo`, `decodeStapleUndo` from Tasks 1–2; `canonicalName` from `@/lib/macro/canon`; `resolveWeekStart` already imported in the actions file.
- Produces:
  - `stapleNameSet(db: Db): Promise<Set<string>>` — canonical names of all staples; the page hides the staple button for rows in this set.
  - `markStapleAction(formData: FormData)` — fields `listId`, `index`, `week`; redirects to `/shopping[?week=next][&|?]undo={payload}`.
  - `undoStapleAction(formData: FormData)` — fields `listId`, `week`, `undo`; redirects to `/shopping[?week=next]`.

- [ ] **Step 1: Write the failing test for `stapleNameSet`**

Extend the `./shopping` import in the test file with `stapleNameSet`, then append:

```ts
describe('stapleNameSet', () => {
  it('returns canonical staple names', async () => {
    const db = await createTestDb();
    await db.insert(pantryStaples).values([{ name: 'scallion' }, { name: 'Olive Oil' }]);
    const set = await stapleNameSet(db);
    expect(set.has('green onion')).toBe(true); // scallion canonicalizes
    expect(set.has('olive oil')).toBe(true);
    expect(set.has('chicken breast')).toBe(false);
  });
});
```

Run: `npx vitest run src/lib/services/shopping.test.ts`
Expected: FAIL — missing export `stapleNameSet`.

- [ ] **Step 2: Implement `stapleNameSet`, verify tests pass**

Append to `src/lib/services/shopping.ts`:

```ts
/** Canonical names of all staples — the list UI hides the mark-as-staple button for these. */
export async function stapleNameSet(db: Db): Promise<Set<string>> {
  const staples = await db.select().from(pantryStaples);
  return new Set(staples.map((s) => canonicalName(s.name)));
}
```

Run: `npx vitest run src/lib/services/shopping.test.ts`
Expected: PASS.

- [ ] **Step 3: Add the server actions**

In `src/app/actions/shopping.ts`, add `redirect` to the imports and extend the service import:

```ts
import { redirect } from 'next/navigation';
import {
  addItem, buildList, decodeStapleUndo, encodeStapleUndo, markItemStaple,
  removeItem, toggleItem, undoMarkStaple,
} from '@/lib/services/shopping';
```

Append the two actions:

```ts
export async function markStapleAction(formData: FormData) {
  const isNext = formData.get('week') === 'next';
  const item = await markItemStaple(getDb(), String(formData.get('listId')), Number(formData.get('index')));
  revalidatePath('/shopping');
  const params = new URLSearchParams(isNext ? { week: 'next' } : {});
  if (item) params.set('undo', encodeStapleUndo({ name: item.name, item }));
  redirect(`/shopping${params.size ? `?${params}` : ''}`);
}

export async function undoStapleAction(formData: FormData) {
  const undo = decodeStapleUndo(String(formData.get('undo') ?? ''));
  if (undo) await undoMarkStaple(getDb(), String(formData.get('listId')), undo.name, undo.item);
  revalidatePath('/shopping');
  redirect(formData.get('week') === 'next' ? '/shopping?week=next' : '/shopping');
}
```

(`redirect` throws internally — it must be the last statement. A failed mark — stale index, deleted list — redirects to a clean URL with no notice, per spec error handling.)

- [ ] **Step 4: Wire up the page**

In `src/app/(app)/shopping/page.tsx`:

1. Extend imports:

```ts
import { decodeStapleUndo, getList, stapleNameSet, staplesCheck, weekHasDinners } from '@/lib/services/shopping';
import { canonicalName } from '@/lib/macro/canon';
import {
  addItemAction, buildListAction, markStapleAction, removeItemAction,
  toggleItemAction, undoStapleAction,
} from '@/app/actions/shopping';
```

2. Widen the searchParams type and decode the undo payload. The signature becomes:

```ts
export default async function ShoppingPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; undo?: string }>;
}) {
  const { week: weekParam, undo: undoParam } = await searchParams;
```

3. In the built-list branch (after `const list = await getList(...)` resolves non-null), fetch the staple set and decode the notice payload:

```ts
  const stapleSet = await stapleNameSet(db);
  const undo = undoParam ? decodeStapleUndo(undoParam) : null;
```

4. Render the undo notice between the header block and the sections `map`:

```tsx
      {undo && (
        <div className="card flex items-center gap-3 border-l-[3px] border-l-bottle p-4 text-sm">
          <p className="flex-1">
            Marked <strong>{undo.name}</strong> as a pantry staple — it won&apos;t appear on future lists.
          </p>
          <form action={undoStapleAction}>
            <input type="hidden" name="listId" value={list.id} />
            <input type="hidden" name="week" value={weekRaw} />
            <input type="hidden" name="undo" value={undoParam} />
            <button className="btn btn-ghost">Undo</button>
          </form>
        </div>
      )}
```

5. In each list row, replace the remove-form block (currently `<form action={removeItemAction} className="ml-auto">…</form>`) with a right-aligned group holding the staple button (hidden for existing staples) and the remove button:

```tsx
                  <div className="ml-auto flex items-center gap-1">
                    {!stapleSet.has(canonicalName(item.name)) && (
                      <form action={markStapleAction} className="flex">
                        <input type="hidden" name="listId" value={list.id} />
                        <input type="hidden" name="index" value={index} />
                        <input type="hidden" name="week" value={weekRaw} />
                        <button
                          aria-label={`Mark ${item.name} as a pantry staple`}
                          title={`Mark ${item.name} as a pantry staple`}
                          className="grid h-8 w-8 -m-1.5 place-content-center text-soft hover:text-bottle"
                        >
                          ⌂
                        </button>
                      </form>
                    )}
                    <form action={removeItemAction} className="flex">
                      <input type="hidden" name="listId" value={list.id} />
                      <input type="hidden" name="index" value={index} />
                      <button
                        aria-label={`Remove ${item.name}`}
                        className="grid h-8 w-8 -m-1.5 place-content-center text-soft hover:text-tomato"
                      >
                        ×
                      </button>
                    </form>
                  </div>
```

Note the `-m-1.5` negative margins on both buttons now sit inside a flex group with `gap-1` — the effective gap stays tap-safe because each button is a 32px (`h-8 w-8`) target.

- [ ] **Step 5: Full verification**

```bash
npm test
npm run build && npx tsc --noEmit
```

Expected: full suite PASS; build and typecheck clean.

- [ ] **Step 6: Manual smoke test (optional but recommended)**

`npm run dev`, open `/shopping` on a week with a built list: tap ⌂ on an item → item disappears, notice appears; tap Undo → item returns (bottom of its section), notice gone; verify a "running low" staple row shows no ⌂; rebuild the list → the marked ingredient stays off.

- [ ] **Step 7: Commit**

```bash
git add src/lib/services/shopping.ts src/lib/services/shopping.test.ts src/app/actions/shopping.ts "src/app/(app)/shopping/page.tsx"
git commit -m "feat: mark-as-staple from the shopping list, with inline undo"
```
