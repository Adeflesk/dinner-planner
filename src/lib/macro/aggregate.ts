import type { Ingredient, StoreSection } from './types';
import { canonicalName, toBuyable } from './canon';

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

// Units you buy in whole numbers — round up AFTER merging so "0.3 + 0.3 lemon"
// becomes 1 lemon, not 2. Weights and volumes stay exact.
const COUNT_UNITS = new Set(['pcs', 'can', 'clove', 'slice']);
const shoppable = (i: ShoppingItem): ShoppingItem =>
  COUNT_UNITS.has(i.unit) ? { ...i, quantity: Math.ceil(i.quantity) } : i;

function merge(dinners: ScaledRecipe[], include: (name: string) => boolean): ShoppingItem[] {
  const map = new Map<string, ShoppingItem>();
  for (const { ingredients, scale } of dinners) {
    for (const i of ingredients) {
      const name = canonicalName(i.name);
      if (!include(name)) continue;
      // Convert toward the buyable unit BEFORE keying, so "337.5 g onion"
      // and "3 pcs onion" land on the same pcs line.
      const b = toBuyable({ name, quantity: i.quantity * scale, unit: canonUnit(i.unit) });
      const key = `${b.name}|${b.unit}`;
      const existing = map.get(key);
      if (existing) existing.quantity += b.quantity;
      else map.set(key, { name: b.name, quantity: b.quantity, unit: b.unit, section: i.section });
    }
  }
  return [...map.values()].map(shoppable).sort(
    (a, b) => SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section) || a.name.localeCompare(b.name),
  );
}

// Tap water is free — never shop for it. Exact match only ("coconut water" stays).
const ALWAYS_EXCLUDED = new Set(['water']);

export function aggregateIngredients(dinners: ScaledRecipe[], staples: string[]): ShoppingItem[] {
  const stapleSet = new Set(staples.map(canonicalName));
  return merge(dinners, (name) => !stapleSet.has(name) && !ALWAYS_EXCLUDED.has(name));
}

export function staplesUsed(dinners: ScaledRecipe[], staples: string[]): ShoppingItem[] {
  const stapleSet = new Set(staples.map(canonicalName));
  return merge(dinners, (name) => stapleSet.has(name));
}
