import { describe, expect, it } from 'vitest';
import { generateRecipe, type RecipeRequest } from './recipes';
import type { AiRecipe } from './schema';

const goodRecipe: AiRecipe = {
  name: 'Chicken stir-fry', cuisine: 'chinese', method: 'Stir fry everything.',
  servings: 4,
  perServing: { kcal: 600, protein: 40, carbs: 55, fat: 20 }, // 4/4/9-consistent
  tags: [],
  ingredients: [{ name: 'chicken breast', quantity: 500, unit: 'g', section: 'meat_fish' }],
};

const req: RecipeRequest = {
  cuisine: 'chinese', targetPerServing: { kcal: 600, protein: 40, carbs: 55, fat: 20 },
  allergies: ['peanut'], dislikes: [], dietTags: [], avoidNames: [],
};

describe('generateRecipe', () => {
  it('returns a valid recipe from the generator', async () => {
    expect(await generateRecipe(req, async () => goodRecipe)).toEqual(goodRecipe);
  });
  it('rejects energy-inconsistent output, retries once, returns the retry', async () => {
    const bad = { ...goodRecipe, perServing: { kcal: 2000, protein: 40, carbs: 55, fat: 20 } };
    let calls = 0;
    const gen = async () => (++calls === 1 ? bad : goodRecipe);
    expect(await generateRecipe(req, gen)).toEqual(goodRecipe);
    expect(calls).toBe(2);
  });
  it('rejects allergy-violating output', async () => {
    const allergenic = {
      ...goodRecipe,
      ingredients: [{ name: 'peanut sauce', quantity: 3, unit: 'tbsp', section: 'pantry' as const }],
    };
    expect(await generateRecipe(req, async () => allergenic)).toBeNull();
  });
  it('returns null when the generator keeps throwing (AI down)', async () => {
    expect(await generateRecipe(req, async () => { throw new Error('timeout'); })).toBeNull();
  });
});
