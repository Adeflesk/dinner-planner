import type { Ingredient, StoreSection } from './types';

export type ShoppingItem = { name: string; quantity: number; unit: string; section: StoreSection };
export type ScaledRecipe = { ingredients: Ingredient[]; scale: number };

export const SECTION_ORDER: StoreSection[] = ['produce', 'meat_fish', 'dairy', 'pantry', 'frozen', 'other'];

// Map common unit spellings to one canonical form so "2 tbsp" + "1 tablespoon" merge.
const UNIT_CANON: Record<string, string> = {
  tablespoon: 'tbsp', tablespoons: 'tbsp', tbsps: 'tbsp', tbsp: 'tbsp',
  teaspoon: 'tsp', teaspoons: 'tsp', tsps: 'tsp', tsp: 'tsp',
  gram: 'g', grams: 'g', gs: 'g', g: 'g',
  kilogram: 'kg', kilograms: 'kg', kg: 'kg',
  milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml', ml: 'ml',
  liter: 'l', liters: 'l', litre: 'l', litres: 'l', l: 'l',
  piece: 'pcs', pieces: 'pcs', pc: 'pcs', pcs: 'pcs',
  clove: 'clove', cloves: 'clove',
  can: 'can', cans: 'can',
  cup: 'cup', cups: 'cup',
  slice: 'slice', slices: 'slice',
};

const norm = (s: string) => s.trim().toLowerCase();
const canonUnit = (u: string) => UNIT_CANON[norm(u)] ?? norm(u);

function merge(dinners: ScaledRecipe[], include: (name: string) => boolean): ShoppingItem[] {
  const map = new Map<string, ShoppingItem>();
  for (const { ingredients, scale } of dinners) {
    for (const i of ingredients) {
      if (!include(norm(i.name))) continue;
      const unit = canonUnit(i.unit);
      const key = `${norm(i.name)}|${unit}`;
      const existing = map.get(key);
      if (existing) existing.quantity += i.quantity * scale;
      else map.set(key, { name: i.name, quantity: i.quantity * scale, unit, section: i.section });
    }
  }
  return [...map.values()].sort(
    (a, b) => SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section) || a.name.localeCompare(b.name),
  );
}

export function aggregateIngredients(dinners: ScaledRecipe[], staples: string[]): ShoppingItem[] {
  const stapleSet = new Set(staples.map(norm));
  return merge(dinners, (name) => !stapleSet.has(name));
}

export function staplesUsed(dinners: ScaledRecipe[], staples: string[]): ShoppingItem[] {
  const stapleSet = new Set(staples.map(norm));
  return merge(dinners, (name) => stapleSet.has(name));
}
