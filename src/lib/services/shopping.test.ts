import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@/lib/test/db';
import type { Db } from '@/lib/db';
import { pantryStaples, plannedDinners, recipes, weekPlans } from '@/lib/db/schema';
import { addItem, buildList, toggleItem, weekHasDinners } from './shopping';

const WEEK = '2026-06-29';

/** One planned dinner (scale 1) using olive oil (a staple) and chicken. */
async function seedWeek(db: Db) {
  await db.insert(pantryStaples).values({ name: 'olive oil' });
  const [recipe] = await db.insert(recipes).values({
    name: 'Roast chicken',
    perServing: { kcal: 600, protein: 40, carbs: 55, fat: 20 },
    servings: 4,
    ingredients: [
      { name: 'olive oil', quantity: 2, unit: 'tbsp', section: 'pantry' },
      { name: 'chicken breast', quantity: 500, unit: 'g', section: 'meat_fish' },
    ],
  }).returning();
  const [plan] = await db.insert(weekPlans).values({ weekStart: WEEK }).returning();
  await db.insert(plannedDinners).values({
    weekPlanId: plan.id, day: 0, recipeId: recipe.id, householdServings: 4, portions: [],
  });
}

describe('weekHasDinners', () => {
  it('is false for an unplanned week and true once a dinner exists', async () => {
    const db = await createTestDb();
    expect(await weekHasDinners(db, WEEK)).toBe(false);
    await seedWeek(db);
    expect(await weekHasDinners(db, WEEK)).toBe(true);
  });
});

describe('buildList rebuild behaviour', () => {
  it('keeps previously ticked low staples on rebuild, quantity re-derived', async () => {
    const db = await createTestDb();
    await seedWeek(db);
    await buildList(db, WEEK, ['olive oil']); // first build: user ticked olive oil
    const rebuilt = (await buildList(db, WEEK, []))!; // rebuild posts no staples
    const oil = rebuilt.items.find((i) => i.name.toLowerCase() === 'olive oil');
    expect(oil).toBeDefined();
    expect(oil!.quantity).toBe(2);
  });

  it('merges newly ticked staples with carried-over ones', async () => {
    const db = await createTestDb();
    await seedWeek(db);
    await db.insert(pantryStaples).values({ name: 'chicken breast' }); // second staple in use
    await buildList(db, WEEK, ['olive oil']);
    const rebuilt = (await buildList(db, WEEK, ['chicken breast']))!;
    const names = rebuilt.items.map((i) => i.name.toLowerCase());
    expect(names).toContain('olive oil');      // carried
    expect(names).toContain('chicken breast'); // newly ticked
  });

  it('preserves checked state of matching items across rebuild', async () => {
    const db = await createTestDb();
    await seedWeek(db);
    const list = (await buildList(db, WEEK, []))!;
    const idx = list.items.findIndex((i) => i.name === 'chicken breast');
    await toggleItem(db, list.id, idx); // ticked off in the shop
    const rebuilt = (await buildList(db, WEEK, []))!;
    const chicken = rebuilt.items.find((i) => i.name === 'chicken breast');
    expect(chicken!.checked).toBe(true);
  });

  it('manual items survive rebuild with their checked state', async () => {
    const db = await createTestDb();
    await seedWeek(db);
    const list = (await buildList(db, WEEK, []))!;
    await addItem(db, list.id, 'dishwasher tablets');
    const withManual = (await buildList(db, WEEK, []))!;
    const manual = withManual.items.find((i) => i.manual);
    expect(manual?.name).toBe('dishwasher tablets');
  });

  it('does not resurrect a staple the week no longer uses', async () => {
    const db = await createTestDb();
    await seedWeek(db);
    await buildList(db, WEEK, ['olive oil']);
    // The week's only dinner now uses no olive oil.
    const [recipe] = await db.select().from(recipes);
    await db.update(recipes).set({
      ingredients: [{ name: 'chicken breast', quantity: 500, unit: 'g', section: 'meat_fish' }],
    }).where(eq(recipes.id, recipe.id));
    const rebuilt = (await buildList(db, WEEK, []))!;
    expect(rebuilt.items.map((i) => i.name.toLowerCase())).not.toContain('olive oil');
  });
});
