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

  const items: StoredShoppingItem[] = aggregateIngredients(dinners, staples.map((s) => s.name))
    .map((i) => ({ ...i, checked: false, manual: false }));
  const low = staplesUsed(dinners, staples.map((s) => s.name))
    .filter((s) => lowStapleNames.some((n) => n.toLowerCase() === s.name.toLowerCase()))
    .map((i) => ({ ...i, checked: false, manual: false }));
  items.push(...low);

  // Manually added items survive a rebuild.
  const [existing] = await db.select().from(shoppingLists).where(eq(shoppingLists.weekPlanId, plan.id));
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
