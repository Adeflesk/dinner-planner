import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@/lib/test/db';
import type { Db } from '@/lib/db';
import { recipes } from '@/lib/db/schema';
import { updateRecipe, type RecipeEditInput } from './recipes';

/** A stored family recipe whose ingredients carry real store sections. */
async function seedRecipe(db: Db) {
  const [recipe] = await db.insert(recipes).values({
    name: 'Roast chicken',
    cuisine: 'british',
    method: 'Roast it.',
    servings: 4,
    perServing: { kcal: 560, protein: 40, carbs: 55, fat: 20 },
    tags: ['comfort'],
    equipment: ['oven'],
    source: 'family',
    ingredients: [
      { name: 'chicken breast', quantity: 500, unit: 'g', section: 'meat_fish' },
      { name: 'green onion', quantity: 2, unit: 'pcs', section: 'produce' },
    ],
  }).returning();
  return recipe;
}

/** Baseline edit input mirroring the seeded recipe (no changes, AI off). */
function baseInput(): RecipeEditInput {
  return {
    name: 'Roast chicken',
    cuisine: 'british',
    servings: 4,
    ingredientLines: '500 g chicken breast\n2 pcs green onion',
    method: 'Roast it.',
    tags: ['comfort'],
    perServing: { kcal: 560, protein: 40, carbs: 55, fat: 20 },
    equipment: ['oven'],
    useAi: false,
  };
}

describe('updateRecipe', () => {
  it('patches scalar fields, tags and equipment; source and createdAt unchanged', async () => {
    const db = await createTestDb();
    const seeded = await seedRecipe(db);
    await updateRecipe(db, seeded.id, {
      ...baseInput(),
      name: 'Sunday roast chicken',
      cuisine: 'irish',
      method: 'Roast it slowly.',
      tags: ['comfort', 'weekend'],
      perServing: { kcal: 600, protein: 42, carbs: 58, fat: 22 },
      equipment: ['oven', 'hob'],
    });
    const [updated] = await db.select().from(recipes).where(eq(recipes.id, seeded.id));
    expect(updated.name).toBe('Sunday roast chicken');
    expect(updated.cuisine).toBe('irish');
    expect(updated.method).toBe('Roast it slowly.');
    expect(updated.tags).toEqual(['comfort', 'weekend']);
    expect(updated.perServing).toEqual({ kcal: 600, protein: 42, carbs: 58, fat: 22 });
    expect(updated.equipment).toEqual(['oven', 'hob']);
    expect(updated.source).toBe('family');
    expect(updated.createdAt).toEqual(seeded.createdAt);
  });

  it('keeps stored store sections for surviving ingredients, matched canonically', async () => {
    const db = await createTestDb();
    const seeded = await seedRecipe(db);
    // "scallion" is a synonym of stored "green onion"; "lemon" is new.
    await updateRecipe(db, seeded.id, {
      ...baseInput(),
      ingredientLines: '400 g chicken breast\n3 pcs scallion\n1 pcs lemon',
    });
    const [updated] = await db.select().from(recipes).where(eq(recipes.id, seeded.id));
    expect(updated.ingredients).toEqual([
      { name: 'chicken breast', quantity: 400, unit: 'g', section: 'meat_fish' },
      { name: 'scallion', quantity: 3, unit: 'pcs', section: 'produce' },
      { name: 'lemon', quantity: 1, unit: 'pcs', section: 'other' },
    ]);
  });

  it('is a no-op for an unknown id', async () => {
    const db = await createTestDb();
    const seeded = await seedRecipe(db);
    await updateRecipe(db, '00000000-0000-0000-0000-000000000000', { ...baseInput(), name: 'X' });
    const [row] = await db.select().from(recipes).where(eq(recipes.id, seeded.id));
    expect(row.name).toBe('Roast chicken');
  });
});
