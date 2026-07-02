import type { Ingredient, MacroSet } from './types';

export function energyConsistent(m: MacroSet, tolerance = 0.15): boolean {
  if (m.kcal <= 0) return false;
  const computed = 4 * m.protein + 4 * m.carbs + 9 * m.fat;
  return Math.abs(m.kcal - computed) / m.kcal <= tolerance;
}

export function violatesAllergies(ingredients: Ingredient[], allergies: string[]): string[] {
  return allergies.filter((a) =>
    ingredients.some((i) => i.name.toLowerCase().includes(a.toLowerCase())),
  );
}
