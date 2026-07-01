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
  let equipment = formData.getAll('equipment').map(String);

  if (useAi) {
    const estimate = await estimateRecipe({ name, servings, ingredientLines });
    if (estimate) {
      perServing = estimate.perServing;
      ingredients = estimate.ingredients;
      if (estimate.equipment.length > 0) equipment = estimate.equipment;
    }
    // AI down — fall back to whatever was typed, never block saving
  }

  await db.insert(recipes).values({
    name,
    cuisine: String(formData.get('cuisine')) || 'any',
    method: String(formData.get('method') ?? ''),
    servings,
    perServing,
    tags: String(formData.get('tags') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    equipment,
    source: 'family',
    ingredients,
  });
  revalidatePath('/recipes');
}

export async function deleteRecipe(formData: FormData) {
  const db = getDb();
  const id = String(formData.get('id'));
  // Guard: refuse to delete a recipe that is currently planned (FK constraint)
  const { plannedDinners } = await import('@/lib/db/schema');
  const [inUse] = await db.select().from(plannedDinners).where(eq(plannedDinners.recipeId, id)).limit(1);
  if (inUse) return; // silently skip — UI can surface this if needed
  await db.delete(recipes).where(eq(recipes.id, id));
  revalidatePath('/recipes');
}

export async function promoteToFavourite(formData: FormData) {
  await getDb().update(recipes).set({ source: 'family' })
    .where(eq(recipes.id, String(formData.get('id'))));
  revalidatePath('/recipes');
}
