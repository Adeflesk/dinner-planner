import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@/lib/test/db';
import type { Db } from '@/lib/db';
import { plannedDinners, recipes, shoppingLists, weekPlans } from '@/lib/db/schema';
import { updateRecipe, type RecipeEditInput } from './recipes';
import type { Estimator } from '@/lib/ai/recipes';

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

// kcal = 4*45 + 4*30 + 9*18 = 462 — satisfies the energyConsistent gate.
const fakeEstimator: Estimator = async () => ({
  perServing: { kcal: 462, protein: 45, carbs: 30, fat: 18 },
  equipment: ['steam'],
  ingredients: [{ name: 'salmon', quantity: 400, unit: 'g', section: 'meat_fish' as const }],
});

const failingEstimator: Estimator = async () => { throw new Error('AI down'); };

describe('updateRecipe with AI estimation', () => {
  it('AI estimate overrides typed macros, ingredients and equipment', async () => {
    const db = await createTestDb();
    const seeded = await seedRecipe(db);
    await updateRecipe(db, seeded.id, { ...baseInput(), useAi: true }, fakeEstimator);
    const [updated] = await db.select().from(recipes).where(eq(recipes.id, seeded.id));
    expect(updated.perServing).toEqual({ kcal: 462, protein: 45, carbs: 30, fat: 18 });
    expect(updated.ingredients).toEqual([
      { name: 'salmon', quantity: 400, unit: 'g', section: 'meat_fish' },
    ]);
    expect(updated.equipment).toEqual(['steam']);
  });

  it('falls back to typed values when AI fails — the edit still saves', async () => {
    const db = await createTestDb();
    const seeded = await seedRecipe(db);
    await updateRecipe(
      db, seeded.id,
      { ...baseInput(), name: 'Renamed anyway', ingredientLines: '400 g chicken breast', useAi: true },
      failingEstimator,
    );
    const [updated] = await db.select().from(recipes).where(eq(recipes.id, seeded.id));
    expect(updated.name).toBe('Renamed anyway');
    expect(updated.ingredients).toEqual([
      { name: 'chicken breast', quantity: 400, unit: 'g', section: 'meat_fish' },
    ]);
  });
});

// 2026-07-16 is a Thursday; its week's Monday is 2026-07-13.
const NOW = new Date('2026-07-16T12:00:00Z');
const PAST_WEEK = '2026-06-29';
const CURRENT_WEEK = '2026-07-13';

/** Plan `recipeId` in `weekStart` and give that week a shopping list. Returns the list id. */
async function seedPlannedWeek(db: Db, weekStart: string, recipeId: string) {
  const [plan] = await db.insert(weekPlans).values({ weekStart }).returning();
  await db.insert(plannedDinners).values({
    weekPlanId: plan.id, day: 0, recipeId, householdServings: 4, portions: [],
  });
  const [list] = await db.insert(shoppingLists).values({
    weekPlanId: plan.id,
    items: [{ name: 'chicken breast', quantity: 500, unit: 'g', section: 'meat_fish', checked: false, manual: false }],
  }).returning();
  return list.id;
}

async function listExists(db: Db, listId: string) {
  const [row] = await db.select().from(shoppingLists).where(eq(shoppingLists.id, listId));
  return row !== undefined;
}

describe('updateRecipe shopping-list invalidation', () => {
  it('an ingredient change deletes lists only for current/future weeks containing the recipe', async () => {
    const db = await createTestDb();
    const seeded = await seedRecipe(db);
    const other = await seedRecipe(db); // a second, unrelated recipe
    const pastList = await seedPlannedWeek(db, PAST_WEEK, seeded.id);
    const currentList = await seedPlannedWeek(db, CURRENT_WEEK, seeded.id);
    const unrelatedList = await seedPlannedWeek(db, '2026-07-20', other.id);

    await updateRecipe(db, seeded.id, {
      ...baseInput(),
      ingredientLines: '600 g chicken breast\n2 pcs green onion',
    }, undefined, NOW);

    expect(await listExists(db, pastList)).toBe(true);       // history untouched
    expect(await listExists(db, currentList)).toBe(false);   // invalidated
    expect(await listExists(db, unrelatedList)).toBe(true);  // other recipe's week untouched
  });

  it('a servings change also invalidates', async () => {
    const db = await createTestDb();
    const seeded = await seedRecipe(db);
    const currentList = await seedPlannedWeek(db, CURRENT_WEEK, seeded.id);
    await updateRecipe(db, seeded.id, { ...baseInput(), servings: 6 }, undefined, NOW);
    expect(await listExists(db, currentList)).toBe(false);
  });

  it('a cosmetic edit (name, tags, method, macros) deletes nothing', async () => {
    const db = await createTestDb();
    const seeded = await seedRecipe(db);
    const currentList = await seedPlannedWeek(db, CURRENT_WEEK, seeded.id);
    await updateRecipe(db, seeded.id, {
      ...baseInput(),
      name: 'New name',
      tags: ['renamed'],
      method: 'Different words.',
      perServing: { kcal: 600, protein: 42, carbs: 58, fat: 22 },
    }, undefined, NOW);
    expect(await listExists(db, currentList)).toBe(true);
  });
});
