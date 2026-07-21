'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { recipes } from '@/lib/db/schema';
import { estimateRecipe } from '@/lib/ai/recipes';
import { parseIngredientLines } from '@/lib/services/ingredients';
import { updateRecipe } from '@/lib/services/recipes';
import { CAPABILITIES, type Capability } from '@/lib/macro/equipment';

// A non-UUID id would make the uuid-typed query throw; treat it as a no-op instead.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      const validEquipment = estimate.equipment.filter((e): e is Capability => (CAPABILITIES as readonly string[]).includes(e));
      if (validEquipment.length > 0) equipment = validEquipment;
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

export async function updateRecipeAction(formData: FormData) {
  const id = String(formData.get('id'));
  if (!UUID_RE.test(id)) return; // malformed id — return without changes
  await updateRecipe(getDb(), id, {
    name: String(formData.get('name')),
    cuisine: String(formData.get('cuisine')) || 'any',
    servings: Number(formData.get('servings')) || 4,
    ingredientLines: String(formData.get('ingredients')),
    method: String(formData.get('method') ?? ''),
    tags: String(formData.get('tags') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    perServing: {
      kcal: Number(formData.get('kcal')) || 0,
      protein: Number(formData.get('protein')) || 0,
      carbs: Number(formData.get('carbs')) || 0,
      fat: Number(formData.get('fat')) || 0,
    },
    equipment: formData.getAll('equipment').map(String),
    useAi: formData.get('estimateWithAi') === 'on',
  });
  revalidatePath('/recipes');
  revalidatePath(`/recipes/${id}`);
  revalidatePath('/shopping');
  revalidatePath('/'); // recipe names appear on the plan
  redirect(`/recipes/${id}`);
}
