import { describe, expect, it } from 'vitest';
import { energyConsistent, violatesAllergies } from './validate';
import type { Ingredient } from './types';

describe('energyConsistent (4/4/9 rule, ±15%)', () => {
  it('accepts macros that roughly match kcal', () => {
    // 4*40 + 4*55 + 9*20 = 560 vs 600 → 6.7% off
    expect(energyConsistent({ kcal: 600, protein: 40, carbs: 55, fat: 20 })).toBe(true);
  });
  it('rejects macros far from kcal', () => {
    // computed 560 vs claimed 1000 → 44% off
    expect(energyConsistent({ kcal: 1000, protein: 40, carbs: 55, fat: 20 })).toBe(false);
  });
  it('rejects zero or negative kcal', () => {
    expect(energyConsistent({ kcal: 0, protein: 0, carbs: 0, fat: 0 })).toBe(false);
  });
});

describe('violatesAllergies', () => {
  const ings: Ingredient[] = [
    { name: 'peanut butter', quantity: 2, unit: 'tbsp', section: 'pantry' },
    { name: 'chicken breast', quantity: 500, unit: 'g', section: 'meat_fish' },
  ];
  it('returns matched allergens (substring, case-insensitive)', () => {
    expect(violatesAllergies(ings, ['Peanut', 'shellfish'])).toEqual(['Peanut']);
  });
  it('returns empty array when clean', () => {
    expect(violatesAllergies(ings, ['shellfish'])).toEqual([]);
  });
});
