import { eq } from 'drizzle-orm';
import type { Db } from '@/lib/db';
import {
  pantryStaples, plannedDinners, recipes, shoppingLists, weekPlans, type StoredShoppingItem,
} from '@/lib/db/schema';
import { aggregateIngredients, staplesUsed, SECTION_ORDER, type ScaledRecipe } from '@/lib/macro/aggregate';
import { canonicalName } from '@/lib/macro/canon';

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

/** Whether any dinner is planned this week — drives the shopping page's empty-state copy. */
export async function weekHasDinners(db: Db, weekStart: string): Promise<boolean> {
  const [plan] = await db.select().from(weekPlans).where(eq(weekPlans.weekStart, weekStart));
  if (!plan) return false;
  const [dinner] = await db.select({ id: plannedDinners.id }).from(plannedDinners)
    .where(eq(plannedDinners.weekPlanId, plan.id)).limit(1);
  return dinner !== undefined;
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
  const [existing] = await db.select().from(shoppingLists).where(eq(shoppingLists.weekPlanId, plan.id));

  // A rebuild posts no staple choices, so carry forward the staples already on the
  // list (the user ticked them as "running low" once — don't silently drop them).
  // Quantities are re-derived below via staplesUsed, so a staple the week no
  // longer uses falls off naturally.
  const stapleNames = new Set(staples.map((s) => canonicalName(s.name)));
  const carried = (existing?.items ?? [])
    .filter((i) => !i.manual && stapleNames.has(canonicalName(i.name)))
    .map((i) => i.name);
  const lowNames = new Set([...lowStapleNames, ...carried].map(canonicalName));

  // Items ticked off in the shop stay ticked across a rebuild (matched by name+unit).
  const wasChecked = new Set(
    (existing?.items ?? []).filter((i) => i.checked).map((i) => `${i.name.toLowerCase()}|${i.unit}`),
  );
  const withState = (i: { name: string; unit: string } & Omit<StoredShoppingItem, 'checked' | 'manual'>): StoredShoppingItem =>
    ({ ...i, checked: wasChecked.has(`${i.name.toLowerCase()}|${i.unit}`), manual: false });

  const items: StoredShoppingItem[] = aggregateIngredients(dinners, staples.map((s) => s.name)).map(withState);
  const low = staplesUsed(dinners, staples.map((s) => s.name))
    .filter((s) => lowNames.has(canonicalName(s.name)))
    .map(withState);
  items.push(...low);

  // Manually added items survive a rebuild (with whatever checked state they had).
  if (existing) items.push(...existing.items.filter((i) => i.manual));

  // Atomic upsert: single statement, no delete-then-insert window.
  // weekPlanId has a unique constraint so ON CONFLICT targets it.
  const [list] = await db.insert(shoppingLists)
    .values({ weekPlanId: plan.id, items })
    .onConflictDoUpdate({ target: shoppingLists.weekPlanId, set: { items } })
    .returning();
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
  const items = [
    ...list.items,
    { name, quantity: 1, unit: 'pcs', section: 'other' as const, checked: false, manual: true },
  ];
  await db.update(shoppingLists).set({ items }).where(eq(shoppingLists.id, listId));
}

export async function removeItem(db: Db, listId: string, index: number) {
  const [list] = await db.select().from(shoppingLists).where(eq(shoppingLists.id, listId));
  if (!list) return;
  const items = list.items.filter((_, i) => i !== index);
  await db.update(shoppingLists).set({ items }).where(eq(shoppingLists.id, listId));
}

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
      || !(SECTION_ORDER as readonly string[]).includes(parsed.item.section)
      || typeof parsed.item.checked !== 'boolean'
      || typeof parsed.item.manual !== 'boolean'
    ) return null;
    return parsed as StapleUndo;
  } catch {
    return null;
  }
}
