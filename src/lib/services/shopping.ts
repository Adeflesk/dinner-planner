import { eq } from 'drizzle-orm';
import type { Db } from '@/lib/db';
import {
  pantryStaples, plannedDinners, recipes, shoppingLists, weekPlans, type StoredShoppingItem,
} from '@/lib/db/schema';
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
  const [existing] = await db.select().from(shoppingLists).where(eq(shoppingLists.weekPlanId, plan.id));

  // A rebuild posts no staple choices, so carry forward the staples already on the
  // list (the user ticked them as "running low" once — don't silently drop them).
  // Quantities are re-derived below via staplesUsed, so a staple the week no
  // longer uses falls off naturally.
  const stapleNames = new Set(staples.map((s) => s.name.toLowerCase()));
  const carried = (existing?.items ?? [])
    .filter((i) => !i.manual && stapleNames.has(i.name.toLowerCase()))
    .map((i) => i.name);
  const lowNames = new Set([...lowStapleNames, ...carried].map((n) => n.toLowerCase()));

  // Items ticked off in the shop stay ticked across a rebuild (matched by name+unit).
  const wasChecked = new Set(
    (existing?.items ?? []).filter((i) => i.checked).map((i) => `${i.name.toLowerCase()}|${i.unit}`),
  );
  const withState = (i: { name: string; unit: string } & Omit<StoredShoppingItem, 'checked' | 'manual'>): StoredShoppingItem =>
    ({ ...i, checked: wasChecked.has(`${i.name.toLowerCase()}|${i.unit}`), manual: false });

  const items: StoredShoppingItem[] = aggregateIngredients(dinners, staples.map((s) => s.name)).map(withState);
  const low = staplesUsed(dinners, staples.map((s) => s.name))
    .filter((s) => lowNames.has(s.name.toLowerCase()))
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
