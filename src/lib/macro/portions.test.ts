import { describe, expect, it } from 'vitest';
import { scale, solvePortions } from './portions';
import type { MacroSet } from './types';

const perServing: MacroSet = { kcal: 600, protein: 40, carbs: 55, fat: 20 };

describe('scale', () => {
  it('multiplies every macro', () => {
    expect(scale(perServing, 1.5)).toEqual({ kcal: 900, protein: 60, carbs: 82.5, fat: 30 });
  });
});

describe('solvePortions', () => {
  it('rounds servings to nearest 0.25 to hit each person kcal target', () => {
    const { portions, householdServings } = solvePortions(perServing, [
      { personId: 'dad', target: { kcal: 930, protein: 50, carbs: 90, fat: 26 } },  // 1.55 → 1.5
      { personId: 'kid', target: { kcal: 450, protein: 25, carbs: 45, fat: 14 } },  // 0.75
    ]);
    expect(portions[0].servings).toBe(1.5);
    expect(portions[1].servings).toBe(0.75);
    expect(householdServings).toBeCloseTo(2.25);
  });
  it('flags portions outside 10% kcal tolerance', () => {
    const { portions } = solvePortions(perServing, [
      { personId: 'a', target: { kcal: 900, protein: 1, carbs: 1, fat: 1 } },   // 1.5 → 900 exact
      { personId: 'b', target: { kcal: 2500, protein: 1, carbs: 1, fat: 1 } },  // clamped to 3 → 1800, off
    ]);
    expect(portions[0].withinTolerance).toBe(true);
    expect(portions[1].withinTolerance).toBe(false);
  });
  it('clamps servings to [0.5, 3]', () => {
    const { portions } = solvePortions(perServing, [
      { personId: 'tiny', target: { kcal: 100, protein: 1, carbs: 1, fat: 1 } },
      { personId: 'huge', target: { kcal: 9000, protein: 1, carbs: 1, fat: 1 } },
    ]);
    expect(portions[0].servings).toBe(0.5);
    expect(portions[1].servings).toBe(3);
  });
});
