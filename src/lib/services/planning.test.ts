import { describe, expect, it, vi } from 'vitest';
import { createTestDb } from '@/lib/test/db';
import { eq } from 'drizzle-orm';
import { people, recipes, settings, plannedDinners, weekPlans } from '@/lib/db/schema';
import { getWeek, planWeek, pickerOptions, swapDay } from './planning';
import { buildList, getList } from './shopping';
import type { Generator } from '@/lib/ai/recipes';
import type { RecipeRequest } from '@/lib/ai/recipes';

const adult = {
  name: 'A', age: 40, sex: 'male' as const, weightKg: 80, heightCm: 180,
  activity: 'moderate' as const, goal: 'maintain' as const, allergies: [], dislikes: [],
};

const makeAi = (equipment: string[], ingredient = 'thing'): Generator => async (req) => ({
  name: `AI ${req.cuisine} ${Math.random()}`, cuisine: req.cuisine, method: 'cook', servings: 4,
  perServing: { kcal: 600, protein: 40, carbs: 55, fat: 20 }, tags: req.dietTags, equipment,
  ingredients: [{ name: ingredient, quantity: 1, unit: 'pcs', section: 'other' }],
});

describe('planWeek gap reporting', () => {
  it('reports no gaps when every night is filled', async () => {
    const db = await createTestDb();
    await db.insert(people).values(adult);
    await db.insert(settings).values({ id: 1, cuisines: ['italian'], equipment: [] });

    const { filled, gaps } = await planWeek(db, '2026-06-29', makeAi([]));

    expect(filled).toBe(7);
    expect(gaps).toBe(0);
  });

  it('reports the gaps left when AI fills nothing and there are no favourites', async () => {
    const db = await createTestDb();
    await db.insert(people).values(adult);
    await db.insert(settings).values({ id: 1, cuisines: ['italian'], equipment: [] });

    const { aiDegraded, filled, gaps } = await planWeek(db, '2026-06-29', async () => {
      throw new Error('gateway down');
    });

    expect(aiDegraded).toBe(true);
    expect(filled).toBe(0);
    expect(gaps).toBe(7);
  });

  it('counts favourite backfills as filled, so a degraded week can still have no gaps', async () => {
    const db = await createTestDb();
    await db.insert(people).values(adult);
    await db.insert(settings).values({ id: 1, cuisines: ['italian'], equipment: [] });
    for (let i = 0; i < 7; i++) {
      await db.insert(recipes).values({
        name: `Favourite ${i}`, cuisine: 'italian', method: '', servings: 4,
        perServing: { kcal: 600, protein: 40, carbs: 55, fat: 20 },
        tags: [], equipment: [], source: 'family',
        ingredients: [{ name: 'x', quantity: 1, unit: 'pcs', section: 'other' }],
      });
    }

    const { aiDegraded, filled, gaps } = await planWeek(db, '2026-06-29', async () => {
      throw new Error('gateway down');
    });

    expect(aiDegraded).toBe(true);
    expect(filled).toBe(7);
    expect(gaps).toBe(0);
  });

  it('logs one summary line carrying the cuisine spread', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const db = await createTestDb();
    await db.insert(people).values(adult);
    await db.insert(settings).values({ id: 1, cuisines: [], equipment: [] });

    await planWeek(db, '2026-06-29', makeAi([]));

    const summary = log.mock.calls
      .map((c) => JSON.parse(c[0] as string))
      .find((e) => e.evt === 'plan.summary');
    expect(summary).toMatchObject({ weekStart: '2026-06-29', filled: 7, gaps: 0 });
    // Eight default cuisines over seven nights → seven distinct, one night each.
    expect(Object.keys(summary.cuisines)).toHaveLength(7);
    vi.restoreAllMocks();
  });
});

describe('getWeek', () => {
  it('exposes the weekly macro target alongside the tally', async () => {
    const db = await createTestDb();
    await db.insert(people).values(adult);
    await db.insert(settings).values({ id: 1, cuisines: ['italian'], equipment: [] });
    await planWeek(db, '2026-06-29', makeAi([]));

    const week = await getWeek(db, '2026-06-29');
    // Target for the number of nights actually planned; one adult → strictly positive.
    expect(week.weeklyTarget.kcal).toBeGreaterThan(0);
    expect(week.weeklyTarget.protein).toBeGreaterThan(0);
  });
});

describe('planWeek equipment re-screen', () => {
  it('never persists a recipe needing gear the household lacks', async () => {
    const db = await createTestDb();
    await db.insert(people).values(adult);
    await db.insert(settings).values({ id: 1, cuisines: ['italian'], equipment: ['steam'] });

    // Generator always returns a recipe needing sous-vide, which the household lacks.
    const { aiDegraded } = await planWeek(db, '2026-06-29', makeAi(['sous-vide']));

    const planned = await db.select().from(plannedDinners);
    const planatedRecipes = await db.select().from(recipes);
    // Re-screen rejects every AI recipe → no AI dinners persisted, week is favourites-only (empty here).
    expect(planatedRecipes).toHaveLength(0);
    expect(planned.length).toBe(0);
    expect(aiDegraded).toBe(true);
  });

  it('persists AI recipes that only use available gear', async () => {
    const db = await createTestDb();
    await db.insert(people).values(adult);
    await db.insert(settings).values({ id: 1, cuisines: ['italian'], equipment: ['steam'] });

    await planWeek(db, '2026-06-29', makeAi(['steam']));

    const planatedRecipes = await db.select().from(recipes);
    expect(planatedRecipes.length).toBeGreaterThan(0);
    // Every AI recipe persisted must carry exactly the equipment the generator returned.
    expect(planatedRecipes.every((r) => JSON.stringify(r.equipment) === JSON.stringify(['steam']))).toBe(true);
  });

  it('passes per-day preferBenefit to the generator (speed weeknight, quality weekend)', async () => {
    const db = await createTestDb();
    await db.insert(people).values(adult);
    await db.insert(settings).values({ id: 1, cuisines: ['italian'], equipment: ['steam'] });

    const seenBenefits = new Set<string>();
    const capturingGen: Generator = async (req: RecipeRequest) => {
      seenBenefits.add(req.preferBenefit);
      return {
        name: `AI dish ${Math.random()}`, cuisine: req.cuisine, method: 'cook', servings: 4,
        perServing: { kcal: 600, protein: 40, carbs: 55, fat: 20 }, tags: req.dietTags, equipment: [],
        ingredients: [{ name: 'thing', quantity: 1, unit: 'pcs', section: 'other' }],
      };
    };

    await planWeek(db, '2026-06-29', capturingGen);

    // At least 'speed' (weeknight Mon-Thu = days 0-3) should have been requested.
    // With a full week including Fri-Sun, 'quality' should appear too.
    expect([...seenBenefits]).toContain('speed');
    expect([...seenBenefits]).toContain('quality');
  });
});

describe('two-week window', () => {
  it('this week and next week plan and shop independently', async () => {
    const db = await createTestDb();
    await db.insert(people).values(adult);
    await db.insert(settings).values({ id: 1, cuisines: ['italian'], equipment: [] });

    // Each week's dinners carry an ingredient only that week uses, so a query that
    // lost its weekPlanId filter shows up as wrong list *content*, not just wrong ids.
    await planWeek(db, '2026-07-06', makeAi([], 'thisweekonly'));
    await planWeek(db, '2026-07-13', makeAi([], 'nextweekonly'));

    const planId = async (weekStart: string) =>
      (await db.select().from(weekPlans).where(eq(weekPlans.weekStart, weekStart)))[0].id;
    const dinnersOf = async (weekStart: string) =>
      db.select().from(plannedDinners).where(eq(plannedDinners.weekPlanId, await planId(weekStart)));

    // Exact counts: 7 nights each, and nothing beyond those two weeks.
    expect(await dinnersOf('2026-07-06')).toHaveLength(7);
    expect(await dinnersOf('2026-07-13')).toHaveLength(7);
    expect(await db.select().from(plannedDinners)).toHaveLength(14);

    const thisList = (await buildList(db, '2026-07-06', []))!;
    const nextList = (await buildList(db, '2026-07-13', []))!;
    expect(thisList.id).not.toBe(nextList.id);
    expect(thisList.items.map((i) => i.name)).toEqual(['thisweekonly']);
    expect(nextList.items.map((i) => i.name)).toEqual(['nextweekonly']);

    // Re-planning NEXT week invalidates only next week's list.
    await planWeek(db, '2026-07-13', makeAi([], 'nextweekonly'));
    expect(await getList(db, '2026-07-06')).not.toBeNull();
    expect(await getList(db, '2026-07-13')).toBeNull();
  });
});

describe('pickerOptions', () => {
  const recipeRow = (name: string, source: 'family' | 'ai', createdAt: Date) => ({
    name, cuisine: 'italian', method: '', servings: 4,
    perServing: { kcal: 600.4, protein: 40, carbs: 55, fat: 20 },
    tags: [], equipment: [], source,
    ingredients: [{ name: 'x', quantity: 1, unit: 'pcs', section: 'other' as const }],
    createdAt,
  });

  it('lists favourites before AI dinners, newest first within each group', async () => {
    const db = await createTestDb();
    await db.insert(recipes).values([
      recipeRow('Old Fav', 'family', new Date('2026-01-01')),
      recipeRow('New Fav', 'family', new Date('2026-06-01')),
      recipeRow('Old AI', 'ai', new Date('2026-02-01')),
      recipeRow('New AI', 'ai', new Date('2026-07-01')),
    ]);

    const opts = await pickerOptions(db, '2026-07-06');

    expect(opts.map((o) => o.name)).toEqual(['New Fav', 'Old Fav', 'New AI', 'Old AI']);
    expect(opts[0].favourite).toBe(true);
    expect(opts[3].favourite).toBe(false);
    expect(opts[0].kcal).toBe(600); // rounded for display
  });

  it('filters by name case-insensitively; a blank query filters nothing', async () => {
    const db = await createTestDb();
    await db.insert(recipes).values([
      recipeRow('Chicken Katsu', 'family', new Date('2026-01-01')),
      recipeRow('Beef Rendang', 'family', new Date('2026-01-02')),
    ]);

    const names = async (q?: string) => (await pickerOptions(db, '2026-07-06', q)).map((o) => o.name);

    expect(await names('chick')).toEqual(['Chicken Katsu']);
    expect(await names('KATSU')).toEqual(['Chicken Katsu']);
    expect(await names('   ')).toHaveLength(2);
    expect(await names()).toHaveLength(2);
  });

  it('marks the day a recipe occupies this week and ignores other weeks', async () => {
    const db = await createTestDb();
    await db.insert(people).values(adult);
    await db.insert(settings).values({ id: 1, cuisines: ['italian'], equipment: [] });
    await planWeek(db, '2026-07-06', makeAi([]));

    const thisWeek = await pickerOptions(db, '2026-07-06');
    expect(thisWeek.map((o) => o.plannedDay).sort((a, b) => a! - b!)).toEqual([0, 1, 2, 3, 4, 5, 6]);

    const otherWeek = await pickerOptions(db, '2026-07-13');
    expect(otherWeek.every((o) => o.plannedDay === null)).toBe(true);
  });

  it('does not create a week plan row just by looking', async () => {
    const db = await createTestDb();
    await db.insert(recipes).values([recipeRow('Solo', 'family', new Date('2026-01-01'))]);

    await pickerOptions(db, '2026-07-06');

    expect(await db.select().from(weekPlans)).toHaveLength(0);
  });
});

describe('swapDay by explicit recipe id', () => {
  it('fills a day that has no dinner at all', async () => {
    const db = await createTestDb();
    await db.insert(people).values(adult);
    await db.insert(settings).values({ id: 1, cuisines: ['italian'], equipment: ['steam'] });
    // Every AI suggestion needs gear the household lacks, so the re-screen rejects
    // them all: the week plan exists but every day is empty — the gap the Plan
    // page now offers "Pick manually" on.
    await planWeek(db, '2026-07-06', makeAi(['sous-vide']));
    const [chosen] = await db.insert(recipes).values({
      name: 'Gap Filler', cuisine: 'italian', method: '', servings: 4,
      perServing: { kcal: 600, protein: 40, carbs: 55, fat: 20 },
      tags: [], equipment: [], source: 'family',
      ingredients: [{ name: 'x', quantity: 1, unit: 'pcs', section: 'other' }],
    }).returning();

    const { ok } = await swapDay(db, '2026-07-06', 3, { recipeId: chosen.id });

    expect(ok).toBe(true);
    const week = await getWeek(db, '2026-07-06');
    expect(week.dinners.find((d) => d.day === 3)!.recipe.name).toBe('Gap Filler');
  });

  it('puts the chosen recipe on the day', async () => {
    const db = await createTestDb();
    await db.insert(people).values(adult);
    await db.insert(settings).values({ id: 1, cuisines: ['italian'], equipment: [] });
    await planWeek(db, '2026-07-06', makeAi([]));

    const [chosen] = await db.insert(recipes).values({
      name: 'Hand Picked', cuisine: 'italian', method: '', servings: 4,
      perServing: { kcal: 600, protein: 40, carbs: 55, fat: 20 },
      tags: [], equipment: [], source: 'family',
      ingredients: [{ name: 'x', quantity: 1, unit: 'pcs', section: 'other' }],
    }).returning();

    const { ok } = await swapDay(db, '2026-07-06', 2, { recipeId: chosen.id });

    expect(ok).toBe(true);
    const week = await getWeek(db, '2026-07-06');
    expect(week.dinners.find((d) => d.day === 2)!.recipe.name).toBe('Hand Picked');
  });

  it('leaves the day untouched when the recipe no longer exists', async () => {
    const db = await createTestDb();
    await db.insert(people).values(adult);
    await db.insert(settings).values({ id: 1, cuisines: ['italian'], equipment: [] });
    await planWeek(db, '2026-07-06', makeAi([]));
    const before = (await getWeek(db, '2026-07-06')).dinners.find((d) => d.day === 2)!.recipe.name;

    const { ok } = await swapDay(db, '2026-07-06', 2, {
      recipeId: '00000000-0000-4000-8000-000000000000',
    });

    expect(ok).toBe(false);
    const after = (await getWeek(db, '2026-07-06')).dinners.find((d) => d.day === 2)!.recipe.name;
    expect(after).toBe(before);
  });
});
