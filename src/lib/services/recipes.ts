import { and, eq, gte, inArray } from 'drizzle-orm';
import type { Db } from '@/lib/db';
import { plannedDinners, recipes, shoppingLists, weekPlans } from '@/lib/db/schema';
import type { Ingredient, MacroSet } from '@/lib/macro/types';
import { canonicalName } from '@/lib/macro/canon';
import { parseIngredientLines } from './ingredients';
import { aiEstimator, estimateRecipe, type Estimator } from '@/lib/ai/recipes';
import { CAPABILITIES, type Capability } from '@/lib/macro/equipment';
import { currentWeekStart } from './dates';

export type RecipeEditInput = {
  name: string;
  cuisine: string;
  servings: number;
  ingredientLines: string;
  method: string;
  tags: string[];
  perServing: MacroSet;
  equipment: string[];
  useAi: boolean;
};

// parseIngredientLines assigns every line section 'other'; keep the stored
// section for ingredients that survive the edit (matched canonically).
function carrySections(parsed: Ingredient[], previous: Ingredient[]): Ingredient[] {
  const sections = new Map(previous.map((i) => [canonicalName(i.name), i.section]));
  return parsed.map((i) => ({ ...i, section: sections.get(canonicalName(i.name)) ?? i.section }));
}

// Postgres jsonb doesn't preserve object key order on round-trip, so
// JSON.stringify can spuriously report a change; compare fields directly.
function ingredientsEqual(a: Ingredient[], b: Ingredient[]): boolean {
  return a.length === b.length && a.every((item, i) =>
    item.name === b[i].name && item.quantity === b[i].quantity
    && item.unit === b[i].unit && item.section === b[i].section);
}

/** Update a recipe in place. `source` and `createdAt` are never touched. */
export async function updateRecipe(
  db: Db,
  id: string,
  input: RecipeEditInput,
  est: Estimator = aiEstimator,
  now: Date = new Date(),
): Promise<void> {
  const [existing] = await db.select().from(recipes).where(eq(recipes.id, id));
  if (!existing) return;

  let perServing = input.perServing;
  let ingredients = carrySections(parseIngredientLines(input.ingredientLines), existing.ingredients);
  let equipment = input.equipment;

  if (input.useAi) {
    const estimate = await estimateRecipe(
      { name: input.name, servings: input.servings, ingredientLines: input.ingredientLines },
      est,
    );
    if (estimate) {
      perServing = estimate.perServing;
      ingredients = estimate.ingredients;
      const valid = estimate.equipment.filter((e): e is Capability => (CAPABILITIES as readonly string[]).includes(e));
      if (valid.length > 0) equipment = valid;
    }
    // AI down — fall back to what was typed, never block saving
  }

  const listsStale = input.servings !== existing.servings
    || !ingredientsEqual(ingredients, existing.ingredients);

  await db.update(recipes).set({
    name: input.name,
    cuisine: input.cuisine,
    method: input.method,
    servings: input.servings,
    perServing,
    tags: input.tags,
    equipment,
    ingredients,
  }).where(eq(recipes.id, id));

  if (listsStale) {
    // Same invalidation a re-plan performs, but only for weeks that still lie ahead.
    const affected = await db.select({ weekPlanId: plannedDinners.weekPlanId })
      .from(plannedDinners)
      .innerJoin(weekPlans, eq(plannedDinners.weekPlanId, weekPlans.id))
      .where(and(eq(plannedDinners.recipeId, id), gte(weekPlans.weekStart, currentWeekStart(now))));
    if (affected.length > 0) {
      await db.delete(shoppingLists)
        .where(inArray(shoppingLists.weekPlanId, affected.map((a) => a.weekPlanId)));
    }
  }
}
