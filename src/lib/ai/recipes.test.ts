import { describe, expect, it } from 'vitest';
import { generateRecipe, estimateRecipe, type RecipeRequest } from './recipes';
import type { AiRecipe, MacroEstimate } from './schema';

const goodRecipe: AiRecipe = {
  name: 'Chicken stir-fry', cuisine: 'chinese', method: 'Stir fry everything.',
  servings: 4,
  perServing: { kcal: 600, protein: 40, carbs: 55, fat: 20 }, // 4/4/9-consistent
  tags: [], equipment: [],
  ingredients: [{ name: 'chicken breast', quantity: 500, unit: 'g', section: 'meat_fish' }],
};

const req: RecipeRequest = {
  cuisine: 'chinese', targetPerServing: { kcal: 600, protein: 40, carbs: 55, fat: 20 },
  allergies: ['peanut'], dislikes: [], dietTags: [], avoidNames: [],
  equipment: ['steam', 'air-fry'], preferBenefit: 'speed',
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

describe('generateRecipe equipment re-screen', () => {
  it('rejects a recipe needing gear the household lacks, retries once', async () => {
    const needsSousVide = { ...goodRecipe, equipment: ['sous-vide'] };
    let calls = 0;
    const gen = async () => (++calls === 1 ? needsSousVide : goodRecipe);
    expect(await generateRecipe(req, gen)).toEqual(goodRecipe);
    expect(calls).toBe(2);
  });
  it('accepts a recipe using only available gear', async () => {
    const steamy = { ...goodRecipe, equipment: ['steam'] };
    expect(await generateRecipe(req, async () => steamy)).toEqual(steamy);
  });
  it('returns null when every attempt needs unavailable gear', async () => {
    const needsSousVide = { ...goodRecipe, equipment: ['sous-vide'] };
    expect(await generateRecipe(req, async () => needsSousVide)).toBeNull();
  });
});

const goodEstimate: MacroEstimate = {
  perServing: { kcal: 600, protein: 40, carbs: 55, fat: 20 },
  equipment: [],
  ingredients: [{ name: 'chicken breast', quantity: 500, unit: 'g', section: 'meat_fish' }],
};
const estimateInput = { name: 'Chicken stir-fry', servings: 4, ingredientLines: '500 g chicken breast' };

describe('estimateRecipe', () => {
  it('returns a valid estimate from the estimator', async () => {
    expect(await estimateRecipe(estimateInput, async () => goodEstimate)).toEqual(goodEstimate);
  });
  it('rejects energy-inconsistent output, retries once, returns the retry', async () => {
    const bad = { ...goodEstimate, perServing: { kcal: 2000, protein: 40, carbs: 55, fat: 20 } };
    let calls = 0;
    const est = async () => (++calls === 1 ? bad : goodEstimate);
    expect(await estimateRecipe(estimateInput, est)).toEqual(goodEstimate);
    expect(calls).toBe(2);
  });
  it('returns null when the estimator keeps throwing', async () => {
    expect(await estimateRecipe(estimateInput, async () => { throw new Error('timeout'); })).toBeNull();
  });
});
