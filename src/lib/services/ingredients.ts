import type { Ingredient } from '@/lib/macro/types';

/** Parse "200 g chicken breast" style lines. Sections default to 'other' (AI estimate refines them). */
export function parseIngredientLines(text: string): Ingredient[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^([\d.]+)\s+(\S+)\s+(.+)$/);
      if (m) return { name: m[3], quantity: parseFloat(m[1]), unit: m[2], section: 'other' as const };
      return { name: line, quantity: 1, unit: 'pcs', section: 'other' as const };
    });
}
