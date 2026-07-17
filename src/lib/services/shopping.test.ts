import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@/lib/test/db';
import type { Db } from '@/lib/db';
import { pantryStaples, plannedDinners, recipes, shoppingLists, weekPlans } from '@/lib/db/schema';
import { addItem, buildList, markItemStaple, toggleItem, weekHasDinners, undoMarkStaple, encodeStapleUndo, decodeStapleUndo } from './shopping';

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

/**
 * A pantry staple stored under a synonym ("scallion") whose planned dinner uses
 * the canonical ingredient name ("green onion") — the shape the ingredient canon
 * (Task 2) now produces for staplesUsed()/aggregateIngredients() output.
 */
async function seedSynonymStapleWeek(db: Db) {
  await db.insert(pantryStaples).values({ name: 'scallion' });
  const [recipe] = await db.insert(recipes).values({
    name: 'Stir fry',
    perServing: { kcal: 500, protein: 30, carbs: 50, fat: 15 },
    servings: 4,
    ingredients: [
      { name: 'green onion', quantity: 2, unit: 'pcs', section: 'produce' },
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

  it('carries forward a staple stored under a synonym across rebuild (canon regression)', async () => {
    const db = await createTestDb();
    await seedSynonymStapleWeek(db);
    // First build: user ticks the staple as low. staplesUsed/aggregateIngredients now
    // key everything under the canonical name ("green onion"), so that's the name the
    // staples-check UI shows and the name the caller ticks.
    const first = (await buildList(db, WEEK, ['green onion']))!;
    expect(first.items.map((i) => i.name.toLowerCase())).toContain('green onion');

    // Rebuild posts no staple choices — relies entirely on carry-forward.
    const rebuilt = (await buildList(db, WEEK, []))!;
    expect(rebuilt.items.map((i) => i.name.toLowerCase())).toContain('green onion');
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

describe('markItemStaple', () => {
  it('inserts the staple, removes exactly that item, and returns it', async () => {
    const db = await createTestDb();
    await seedWeek(db);
    const list = (await buildList(db, WEEK, []))!;
    const idx = list.items.findIndex((i) => i.name === 'chicken breast');

    const removed = await markItemStaple(db, list.id, idx);

    expect(removed?.name).toBe('chicken breast');
    const staples = await db.select().from(pantryStaples);
    expect(staples.map((s) => s.name)).toContain('chicken breast');
    const [after] = await db.select().from(shoppingLists).where(eq(shoppingLists.id, list.id));
    expect(after.items.map((i) => i.name)).not.toContain('chicken breast');
    expect(after.items).toHaveLength(list.items.length - 1);
  });

  it('a subsequent buildList excludes the marked ingredient from derived items', async () => {
    const db = await createTestDb();
    await seedWeek(db);
    const list = (await buildList(db, WEEK, []))!;
    const idx = list.items.findIndex((i) => i.name === 'chicken breast');
    await markItemStaple(db, list.id, idx);

    const rebuilt = (await buildList(db, WEEK, []))!;
    expect(rebuilt.items.map((i) => i.name)).not.toContain('chicken breast');
  });

  it('marking an item whose name is already a staple removes it without error', async () => {
    const db = await createTestDb();
    await seedWeek(db);
    // olive oil is already a staple; ticking it low puts it on the list.
    const list = (await buildList(db, WEEK, ['olive oil']))!;
    const idx = list.items.findIndex((i) => i.name.toLowerCase() === 'olive oil');
    expect(idx).toBeGreaterThanOrEqual(0);

    const removed = await markItemStaple(db, list.id, idx);

    expect(removed?.name.toLowerCase()).toBe('olive oil');
    const staples = await db.select().from(pantryStaples);
    expect(staples.filter((s) => s.name.toLowerCase() === 'olive oil')).toHaveLength(1);
    const [after] = await db.select().from(shoppingLists).where(eq(shoppingLists.id, list.id));
    expect(after.items.map((i) => i.name.toLowerCase())).not.toContain('olive oil');
  });

  it('out-of-range index and unknown list id leave everything unchanged', async () => {
    const db = await createTestDb();
    await seedWeek(db);
    const list = (await buildList(db, WEEK, []))!;

    expect(await markItemStaple(db, list.id, 99)).toBeNull();
    expect(await markItemStaple(db, '00000000-0000-0000-0000-000000000000', 0)).toBeNull();

    const [after] = await db.select().from(shoppingLists).where(eq(shoppingLists.id, list.id));
    expect(after.items).toEqual(list.items);
    const staples = await db.select().from(pantryStaples);
    expect(staples).toHaveLength(1); // only the seeded olive oil
  });
});

describe('undoMarkStaple', () => {
  it('restores the item with manual and checked preserved, and deletes the staple', async () => {
    const db = await createTestDb();
    await seedWeek(db);
    const list = (await buildList(db, WEEK, []))!;
    await addItem(db, list.id, 'ketchup');
    let [state] = await db.select().from(shoppingLists).where(eq(shoppingLists.id, list.id));
    const idx = state.items.findIndex((i) => i.name === 'ketchup');
    await toggleItem(db, list.id, idx); // checked: true
    const removed = (await markItemStaple(db, list.id, idx))!;

    await undoMarkStaple(db, list.id, removed.name, removed);

    [state] = await db.select().from(shoppingLists).where(eq(shoppingLists.id, list.id));
    const ketchup = state.items.find((i) => i.name === 'ketchup');
    expect(ketchup).toMatchObject({ manual: true, checked: true });
    const staples = await db.select().from(pantryStaples);
    expect(staples.map((s) => s.name)).not.toContain('ketchup');
  });

  it('a buildList after undo derives the ingredient again', async () => {
    const db = await createTestDb();
    await seedWeek(db);
    const list = (await buildList(db, WEEK, []))!;
    const idx = list.items.findIndex((i) => i.name === 'chicken breast');
    const removed = (await markItemStaple(db, list.id, idx))!;

    await undoMarkStaple(db, list.id, removed.name, removed);

    const rebuilt = (await buildList(db, WEEK, []))!;
    expect(rebuilt.items.map((i) => i.name)).toContain('chicken breast');
  });

  it('no-ops independently when the staple or list is already gone', async () => {
    const db = await createTestDb();
    await seedWeek(db);
    const list = (await buildList(db, WEEK, []))!;
    const item = list.items[0];

    // Unknown list: staple deletion still runs, list append no-ops, no throw.
    await undoMarkStaple(db, '00000000-0000-0000-0000-000000000000', 'olive oil', item);
    expect((await db.select().from(pantryStaples)).map((s) => s.name)).not.toContain('olive oil');

    // Staple already gone: item is still appended, no throw.
    await undoMarkStaple(db, list.id, 'olive oil', item);
    const [after] = await db.select().from(shoppingLists).where(eq(shoppingLists.id, list.id));
    expect(after.items).toHaveLength(list.items.length + 1);
  });
});

describe('staple undo codec', () => {
  it('round-trips a payload', () => {
    const undo = {
      name: 'chicken breast',
      item: { name: 'chicken breast', quantity: 500, unit: 'g', section: 'meat_fish' as const, checked: true, manual: false },
    };
    expect(decodeStapleUndo(encodeStapleUndo(undo))).toEqual(undo);
  });

  it('returns null for garbage, valid-JSON-wrong-shape, and empty input', () => {
    expect(decodeStapleUndo('not-base64-json')).toBeNull();
    expect(decodeStapleUndo(Buffer.from('{"nope":1}').toString('base64url'))).toBeNull();
    expect(decodeStapleUndo('')).toBeNull();
  });

  it('returns null for out-of-enum section', () => {
    const payload = {
      name: 'ketchup',
      item: { name: 'ketchup', quantity: 1, unit: 'bottle', section: 'snacks' as never, checked: false, manual: false },
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    expect(decodeStapleUndo(encoded)).toBeNull();
  });
});
