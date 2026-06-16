import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '@/lib/db/schema';
import type { Db } from '@/lib/db';
import { getOrCreateWeekPlan, getWeek, planWeek, swapDay, togglePin } from '@/lib/services/planning';
import { addItem, buildList, getList, staplesCheck, toggleItem } from '@/lib/services/shopping';
import type { AiRecipe } from '@/lib/ai/schema';

const WEEK = '2026-06-08';

let aiCounter = 0;
const fakeAi = async (req: { cuisine: string }): Promise<AiRecipe> => ({
  name: `AI dinner ${++aiCounter}`, cuisine: req.cuisine, method: 'cook', servings: 4,
  perServing: { kcal: 600, protein: 40, carbs: 55, fat: 20 },
  tags: [],
  ingredients: [
    { name: 'onion', quantity: 1, unit: 'pcs', section: 'produce' },
    { name: 'olive oil', quantity: 1, unit: 'tbsp', section: 'pantry' },
  ],
});

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: './drizzle' });
  await db.insert(schema.people).values([
    { name: 'Dad', age: 40, sex: 'male', weightKg: 80, heightCm: 180, activity: 'moderate', goal: 'maintain', allergies: [], dislikes: [] },
    { name: 'Kid', age: 10, sex: 'female', weightKg: 35, heightCm: 140, activity: 'active', goal: 'maintain', allergies: ['peanut'], dislikes: [] },
  ]);
  await db.insert(schema.settings).values({ id: 1, cuisines: ['mexican', 'italian'], vegetarianNights: 0 });
  await db.insert(schema.recipes).values({
    name: 'Tacos', cuisine: 'mexican', method: 'assemble', servings: 4,
    perServing: { kcal: 650, protein: 35, carbs: 60, fat: 25 }, tags: [], source: 'family',
    ingredients: [
      { name: 'beef mince', quantity: 500, unit: 'g', section: 'meat_fish' },
      { name: 'olive oil', quantity: 2, unit: 'tbsp', section: 'pantry' },
    ],
  });
  await db.insert(schema.pantryStaples).values({ name: 'olive oil' });
  return db;
}

describe('plan → swap → shopping list flow', () => {
  let db: Db;
  beforeEach(async () => { aiCounter = 0; db = await freshDb(); });

  it('plans a 7-day week with portions for each person', async () => {
    const { aiDegraded } = await planWeek(db, WEEK, fakeAi);
    expect(aiDegraded).toBe(false);
    const week = await getWeek(db, WEEK);
    expect(week.dinners).toHaveLength(7);
    for (const d of week.dinners) {
      expect(d.portions).toHaveLength(2);
      expect(d.householdServings).toBeGreaterThan(0);
    }
    expect(week.tally.totals.kcal).toBeGreaterThan(0);
  });

  it('falls back to favourites-only when AI fails, and reports it', async () => {
    const { aiDegraded } = await planWeek(db, WEEK, async () => { throw new Error('down'); });
    expect(aiDegraded).toBe(true);
    const week = await getWeek(db, WEEK);
    expect(week.dinners.length).toBeGreaterThanOrEqual(1); // only 1 favourite seeded
  });

  it('does NOT report degraded when AI only partially fails', async () => {
    // Two cuisines force an alternating sequence, so both appear. Fail one cuisine,
    // succeed the other → some AI dinners land. The week is not "favourites only".
    const partial = async (req: { cuisine: string }) => {
      if (req.cuisine === 'italian') throw new Error('timeout');
      return fakeAi(req);
    };
    const { aiDegraded } = await planWeek(db, WEEK, partial);
    expect(aiDegraded).toBe(false);
    const week = await getWeek(db, WEEK);
    expect(week.dinners.some((d) => d.recipe.source === 'ai')).toBe(true);
  });

  it('swaps a day and pins survive re-planning', async () => {
    await planWeek(db, WEEK, fakeAi);
    const before = (await getWeek(db, WEEK)).dinners.find((d) => d.day === 2)!;
    await swapDay(db, WEEK, 2, 'ai', fakeAi);
    const after = (await getWeek(db, WEEK)).dinners.find((d) => d.day === 2)!;
    expect(after.recipe.name).not.toBe(before.recipe.name);

    await togglePin(db, WEEK, 2);
    await planWeek(db, WEEK, fakeAi);
    const rePlanned = (await getWeek(db, WEEK)).dinners.find((d) => d.day === 2)!;
    expect(rePlanned.recipe.name).toBe(after.recipe.name);
  });

  it('builds a shopping list: aggregated, staples filtered, low staples added back', async () => {
    await planWeek(db, WEEK, fakeAi);
    const used = await staplesCheck(db, WEEK);
    expect(used.map((u) => u.name.toLowerCase())).toContain('olive oil');

    const list = await buildList(db, WEEK, ['olive oil']);
    expect(list).not.toBeNull();
    const names = list!.items.map((i) => i.name.toLowerCase());
    expect(names).toContain('olive oil');           // tapped as low → included
    expect(names).toContain('onion');
    expect(list!.items.filter((i) => i.name.toLowerCase() === 'onion')).toHaveLength(1); // aggregated

    await toggleItem(db, list!.id, 0);
    const reloaded = await getList(db, WEEK);
    expect(reloaded!.items[0].checked).toBe(true);
  });

  it('manually added items survive a rebuild', async () => {
    await planWeek(db, WEEK, fakeAi);
    const list = await buildList(db, WEEK, []);
    await addItem(db, list!.id, 'birthday candles');
    const rebuilt = await buildList(db, WEEK, []);
    expect(rebuilt!.items.map((i) => i.name)).toContain('birthday candles');
  });

  it('does not leave orphaned AI recipes after re-planning', async () => {
    await planWeek(db, WEEK, fakeAi);
    await planWeek(db, WEEK, fakeAi); // re-plan: previous AI recipes are now unreferenced

    const aiRecipes = await db.select().from(schema.recipes).where(eq(schema.recipes.source, 'ai'));
    const planned = await db.select().from(schema.plannedDinners);
    const referencedIds = new Set(planned.map((p) => p.recipeId));
    // every surviving AI recipe must still be referenced by a planned dinner
    for (const r of aiRecipes) expect(referencedIds.has(r.id)).toBe(true);
  });

  it('keeps pinned AI recipes when pruning orphans', async () => {
    await planWeek(db, WEEK, fakeAi);
    const aiDay = (await getWeek(db, WEEK)).dinners.find((d) => d.recipe.source === 'ai')!;
    await togglePin(db, WEEK, aiDay.day);
    await planWeek(db, WEEK, fakeAi);

    const stillThere = await db.select().from(schema.recipes).where(eq(schema.recipes.id, aiDay.recipe.id));
    expect(stillThere).toHaveLength(1); // pinned AI recipe survived the prune
  });

  it('getOrCreateWeekPlan is idempotent under concurrent calls', async () => {
    const [a, b] = await Promise.all([
      getOrCreateWeekPlan(db, '2026-07-06'),
      getOrCreateWeekPlan(db, '2026-07-06'),
    ]);
    expect(a.id).toBe(b.id);
  });
});
