import type { Ingredient, StoreSection } from './types';

export type ShoppingItem = { name: string; quantity: number; unit: string; section: StoreSection };
export type ScaledRecipe = { ingredients: Ingredient[]; scale: number };

export const SECTION_ORDER: StoreSection[] = ['produce', 'meat_fish', 'dairy', 'pantry', 'frozen', 'other'];

const norm = (s: string) => s.trim().toLowerCase();

function merge(dinners: ScaledRecipe[], include: (name: string) => boolean): ShoppingItem[] {
  const map = new Map<string, ShoppingItem>();
  for (const { ingredients, scale } of dinners) {
    for (const i of ingredients) {
      if (!include(norm(i.name))) continue;
      const key = `${norm(i.name)}|${norm(i.unit)}`;
      const existing = map.get(key);
      if (existing) existing.quantity += i.quantity * scale;
      else map.set(key, { name: i.name, quantity: i.quantity * scale, unit: i.unit, section: i.section });
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
