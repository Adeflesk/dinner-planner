import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@/lib/test/db';
import type { Db } from '@/lib/db';
import { plannedDinners, recipes, shoppingLists, weekPlans } from '@/lib/db/schema';
import { deleteRecipe, recipeHistory, updateRecipe, type RecipeEditInput } from './recipes';
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

describe('recipeHistory', () => {
  it('returns occurrences newest first with the cooked date computed from weekStart + day', async () => {
    const db = await createTestDb();
    const seeded = await seedRecipe(db);
    // Thu (day 3) of week 2026-06-29 → 2026-07-02; Mon (day 0) of week 2026-07-13.
    const [older] = await db.insert(weekPlans).values({ weekStart: '2026-06-29' }).returning();
    const [newer] = await db.insert(weekPlans).values({ weekStart: '2026-07-13' }).returning();
    await db.insert(plannedDinners).values([
      { weekPlanId: older.id, day: 3, recipeId: seeded.id, householdServings: 4, portions: [] },
      { weekPlanId: newer.id, day: 0, recipeId: seeded.id, householdServings: 4, portions: [] },
    ]);
    expect(await recipeHistory(db, seeded.id)).toEqual([
      { weekStart: '2026-07-13', day: 0, cookedOn: '2026-07-13' },
      { weekStart: '2026-06-29', day: 3, cookedOn: '2026-07-02' },
    ]);
  });

  it('is empty for a never-planned recipe', async () => {
    const db = await createTestDb();
    const seeded = await seedRecipe(db);
    expect(await recipeHistory(db, seeded.id)).toEqual([]);
  });
});

async function plannedCountFor(db: Db, recipeId: string) {
  const rows = await db.select().from(plannedDinners).where(eq(plannedDinners.recipeId, recipeId));
  return rows.length;
}

async function recipeExists(db: Db, id: string) {
  const [row] = await db.select().from(recipes).where(eq(recipes.id, id));
  return row !== undefined;
}

describe('deleteRecipe', () => {
  it('deletes a recipe whose only history is in a past week', async () => {
    const db = await createTestDb();
    const seeded = await seedRecipe(db);
    const pastList = await seedPlannedWeek(db, PAST_WEEK, seeded.id);
    const result = await deleteRecipe(db, seeded.id, NOW);
    expect(result).toBe('deleted');
    expect(await recipeExists(db, seeded.id)).toBe(false);
    expect(await plannedCountFor(db, seeded.id)).toBe(0);
    expect(await listExists(db, pastList)).toBe(true); // that week's shopping list survives
  });

  it('deletes a recipe with no planned_dinners history at all', async () => {
    const db = await createTestDb();
    const seeded = await seedRecipe(db);
    const result = await deleteRecipe(db, seeded.id, NOW);
    expect(result).toBe('deleted');
    expect(await recipeExists(db, seeded.id)).toBe(false);
  });

  it('blocks deleting a recipe planned in the current week', async () => {
    const db = await createTestDb();
    const seeded = await seedRecipe(db);
    await seedPlannedWeek(db, CURRENT_WEEK, seeded.id);
    const result = await deleteRecipe(db, seeded.id, NOW);
    expect(result).toBe('blocked');
    expect(await recipeExists(db, seeded.id)).toBe(true);
    expect(await plannedCountFor(db, seeded.id)).toBe(1);
  });

  it('blocks deleting a recipe planned in a future week', async () => {
    const db = await createTestDb();
    const seeded = await seedRecipe(db);
    await seedPlannedWeek(db, '2026-07-20', seeded.id); // after CURRENT_WEEK
    const result = await deleteRecipe(db, seeded.id, NOW);
    expect(result).toBe('blocked');
    expect(await recipeExists(db, seeded.id)).toBe(true);
  });

  it('blocks deleting a recipe with both a past and a current occurrence — the past row survives too', async () => {
    const db = await createTestDb();
    const seeded = await seedRecipe(db);
    await seedPlannedWeek(db, PAST_WEEK, seeded.id);
    await seedPlannedWeek(db, CURRENT_WEEK, seeded.id);
    const result = await deleteRecipe(db, seeded.id, NOW);
    expect(result).toBe('blocked');
    expect(await recipeExists(db, seeded.id)).toBe(true);
    expect(await plannedCountFor(db, seeded.id)).toBe(2);
  });

  it('is a no-op for an unknown id', async () => {
    const db = await createTestDb();
    const seeded = await seedRecipe(db);
    const result = await deleteRecipe(db, '00000000-0000-0000-0000-000000000000', NOW);
    expect(result).toBe('deleted');
    expect(await recipeExists(db, seeded.id)).toBe(true);
  });

  it("does not touch a different recipe's planned_dinners rows or shopping lists", async () => {
    const db = await createTestDb();
    const seeded = await seedRecipe(db);
    const other = await seedRecipe(db);
    const otherList = await seedPlannedWeek(db, PAST_WEEK, other.id);
    await deleteRecipe(db, seeded.id, NOW);
    expect(await recipeExists(db, other.id)).toBe(true);
    expect(await plannedCountFor(db, other.id)).toBe(1);
    expect(await listExists(db, otherList)).toBe(true);
  });
});
