import { eq } from 'drizzle-orm';
import type { Db } from '@/lib/db';
import { recipes } from '@/lib/db/schema';
import type { Ingredient, MacroSet } from '@/lib/macro/types';
import { canonicalName } from '@/lib/macro/canon';
import { parseIngredientLines } from './ingredients';
import { aiEstimator, estimateRecipe, type Estimator } from '@/lib/ai/recipes';
import { CAPABILITIES, type Capability } from '@/lib/macro/equipment';

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

/** Update a recipe in place. `source` and `createdAt` are never touched. */
export async function updateRecipe(
  db: Db,
  id: string,
  input: RecipeEditInput,
  est: Estimator = aiEstimator,
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
}
