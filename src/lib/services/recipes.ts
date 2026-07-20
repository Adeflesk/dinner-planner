import { eq } from 'drizzle-orm';
import type { Db } from '@/lib/db';
import { recipes } from '@/lib/db/schema';
import type { Ingredient, MacroSet } from '@/lib/macro/types';
import { canonicalName } from '@/lib/macro/canon';
import { parseIngredientLines } from './ingredients';

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
export async function updateRecipe(db: Db, id: string, input: RecipeEditInput): Promise<void> {
  const [existing] = await db.select().from(recipes).where(eq(recipes.id, id));
  if (!existing) return;

  const ingredients = carrySections(parseIngredientLines(input.ingredientLines), existing.ingredients);

  await db.update(recipes).set({
    name: input.name,
    cuisine: input.cuisine,
    method: input.method,
    servings: input.servings,
    perServing: input.perServing,
    tags: input.tags,
    equipment: input.equipment,
    ingredients,
  }).where(eq(recipes.id, id));
}
