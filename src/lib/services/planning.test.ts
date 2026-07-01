import { describe, expect, it } from 'vitest';
import { createTestDb } from '@/lib/test/db';
import { people, recipes, settings, plannedDinners } from '@/lib/db/schema';
import { planWeek } from './planning';
import type { Generator } from '@/lib/ai/recipes';
import type { RecipeRequest } from '@/lib/ai/recipes';

const adult = {
  name: 'A', age: 40, sex: 'male' as const, weightKg: 80, heightCm: 180,
  activity: 'moderate' as const, goal: 'maintain' as const, allergies: [], dislikes: [],
};

const makeAi = (equipment: string[]): Generator => async (req) => ({
  name: `AI ${req.cuisine} ${Math.random()}`, cuisine: req.cuisine, method: 'cook', servings: 4,
  perServing: { kcal: 600, protein: 40, carbs: 55, fat: 20 }, tags: req.dietTags, equipment,
  ingredients: [{ name: 'thing', quantity: 1, unit: 'pcs', section: 'other' }],
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
    expect(planatedRecipes.every((r) => r.equipment.every((e) => ['steam'].includes(e)))).toBe(true);
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
    expect(planatedRecipes.every((r) => Array.isArray(r.equipment))).toBe(true);
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
