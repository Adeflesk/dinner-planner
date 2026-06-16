import { describe, expect, it } from 'vitest';
import { cuisineSequence, draftWeek, type FavouriteRecipe } from './draft';
import type { AiRecipe } from '@/lib/ai/schema';

const fav = (name: string, cuisine: string, tags: string[] = []): FavouriteRecipe => ({
  id: `fav-${name}`, name, cuisine, method: '', servings: 4,
  perServing: { kcal: 600, protein: 40, carbs: 55, fat: 20 }, tags,
  ingredients: [{ name: 'x', quantity: 1, unit: 'pcs', section: 'other' }],
});

const aiRecipe = (name: string, cuisine: string, tags: string[] = []): AiRecipe => ({
  name, cuisine, method: 'cook', servings: 4,
  perServing: { kcal: 600, protein: 40, carbs: 55, fat: 20 }, tags,
  ingredients: [{ name: 'y', quantity: 1, unit: 'pcs', section: 'other' }],
});

describe('cuisineSequence', () => {
  it('never schedules the same cuisine on adjacent days (≥2 cuisines)', () => {
    const seq = cuisineSequence(['indian', 'mexican', 'italian'], 7, () => 0);
    expect(seq).toHaveLength(7);
    for (let i = 1; i < 7; i++) expect(seq[i]).not.toBe(seq[i - 1]);
  });
  it('allows repeats with a single cuisine', () => {
    expect(cuisineSequence(['italian'], 3, () => 0)).toEqual(['italian', 'italian', 'italian']);
  });
  it("returns 'any' slots when no cuisines configured", () => {
    expect(cuisineSequence([], 2, () => 0)).toEqual(['any', 'any']);
  });
});

describe('draftWeek', () => {
  const favourites = [fav('Tacos', 'mexican'), fav('Curry', 'indian'), fav('Pasta bake', 'italian')];

  it('fills 7 days mixing favourites and AI', async () => {
    // Counter mimics the real generator, which is told avoidNames and returns fresh ideas.
    let n = 0;
    const days = await draftWeek({
      favourites, cuisines: ['mexican', 'indian', 'italian'], recentNames: [],
      pinned: new Map(), vegetarianNights: 0, rng: () => 0,
      generate: async (req) => aiRecipe(`AI ${req.cuisine} ${++n}`, req.cuisine, req.dietTags),
    });
    expect(days).toHaveLength(7);
    expect(days.some((d) => d.source === 'favourite')).toBe(true);
    expect(days.some((d) => d.source === 'ai')).toBe(true);
    const names = days.map((d) => d.recipe.name.toLowerCase());
    expect(new Set(names).size).toBe(7); // no repeats within the week
  });

  it('falls back to favourites only when AI returns null', async () => {
    const days = await draftWeek({
      favourites, cuisines: ['mexican'], recentNames: [],
      pinned: new Map(), vegetarianNights: 0, rng: () => 0,
      generate: async () => null,
    });
    expect(days.every((d) => d.source === 'favourite')).toBe(true);
    expect(days.length).toBeGreaterThan(0);
  });

  it('preserves pinned days', async () => {
    const pinnedDinner = { day: 1, source: 'favourite' as const, recipeId: 'fav-Tacos', recipe: favourites[0] };
    const days = await draftWeek({
      favourites, cuisines: ['indian', 'italian'], recentNames: [],
      pinned: new Map([[1, pinnedDinner]]), vegetarianNights: 0, rng: () => 0,
      generate: async (req) => aiRecipe(`AI ${req.cuisine} ${Math.random()}`, req.cuisine),
    });
    expect(days.find((d) => d.day === 1)).toEqual(pinnedDinner);
  });

  it('avoids recent recipe names', async () => {
    const days = await draftWeek({
      favourites, cuisines: ['mexican', 'indian', 'italian'], recentNames: ['Tacos'],
      pinned: new Map(), vegetarianNights: 0, rng: () => 0,
      generate: async (req) => aiRecipe(`AI ${req.cuisine}`, req.cuisine),
    });
    expect(days.map((d) => d.recipe.name)).not.toContain('Tacos');
  });

  it('requests vegetarian dinners for the configured number of nights', async () => {
    const vegRequests: number[] = [];
    const days = await draftWeek({
      favourites: [], cuisines: ['indian', 'italian'], recentNames: [],
      pinned: new Map(), vegetarianNights: 2, rng: () => 0,
      generate: async (req) => {
        if (req.dietTags.includes('vegetarian')) vegRequests.push(1);
        return aiRecipe(`AI ${req.cuisine} ${req.dietTags.join('')} ${vegRequests.length}`, req.cuisine, req.dietTags);
      },
    });
    expect(days.filter((d) => d.recipe.tags.includes('vegetarian'))).toHaveLength(2);
  });

  it('generates AI dinners concurrently, not one-at-a-time', async () => {
    let active = 0;
    let maxActive = 0;
    const slow = async (req: { cuisine: string }) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return aiRecipe(`AI ${req.cuisine} ${Math.random()}`, req.cuisine);
    };
    await draftWeek({
      favourites: [], cuisines: ['indian', 'italian'], recentNames: [],
      pinned: new Map(), vegetarianNights: 0, rng: () => 0, generate: slow,
    });
    // All 7 days need AI (no favourites); concurrent generation means >1 in flight at once.
    expect(maxActive).toBeGreaterThan(1);
  });
});
