// Cooking-equipment capability vocabulary and the pure helpers that screen and
// rank recipes against a household's kitchen. Deterministic and dependency-free,
// like validate.ts — no I/O, no macro arithmetic.

export const CAPABILITIES = [
  'steam', 'combi-steam', 'microwave', 'convection',
  'grill/broil', 'induction-hob', 'air-fry', 'sous-vide',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

// Only these "standout" capabilities drive biasing and badging; the rest
// (convection, grill/broil, induction-hob, microwave) are gear every kitchen has.
export const STANDOUT: readonly Capability[] = ['steam', 'combi-steam', 'sous-vide', 'air-fry'];

export type Benefit = 'quality' | 'speed';
// The two premium appliances have opposite superpowers: the steam oven's edge is
// quality (moisture, gentle cooking), the air-fry/combi-microwave's edge is speed.
export const BENEFIT: Record<string, Benefit> = {
  steam: 'quality',
  'combi-steam': 'quality',
  'sous-vide': 'quality',
  'air-fry': 'speed',
};

const norm = (s: string) => s.trim().toLowerCase();

/** Weeknights (Mon–Thu, days 0–3) lean speed; weekends (Fri–Sun, 4–6) lean quality. */
export function dayBenefit(day: number): Benefit {
  return day <= 3 ? 'speed' : 'quality';
}

/** The standout capabilities a recipe uses (case-insensitive, deduped). */
export function standoutTags(equipment: string[]): string[] {
  const standout = new Set(STANDOUT.map(norm));
  return [...new Set(equipment.map(norm))].filter((e) => standout.has(e));
}

/**
 * Capabilities a recipe needs that the household does not have. Empty array means
 * the recipe is cookable here. Mirrors validate.ts#violatesAllergies.
 */
export function lacksEquipment(recipeEquipment: string[], household: string[]): string[] {
  const have = new Set(household.map(norm));
  return [...new Set(recipeEquipment.map(norm))].filter((e) => !have.has(e));
}

/**
 * Soft bias score for choosing a favourite on a given day. Higher is better.
 *   +2  uses a standout capability the household actually has
 *   +1  that capability's benefit matches the day (speed weeknight / quality weekend)
 *   -2  repeats a standout capability used the night before (method-spread penalty)
 * A recipe with no usable standout gear scores 0 — never penalised, never preferred.
 */
export function scoreFavourite(
  recipe: { equipment: string[] },
  opts: { day: number; household: string[]; prevStandout: string[] },
): number {
  const have = new Set(opts.household.map(norm));
  const prev = new Set(opts.prevStandout.map(norm));
  const tags = standoutTags(recipe.equipment).filter((t) => have.has(t));
  if (tags.length === 0) return 0;
  let score = 2;
  if (tags.some((t) => BENEFIT[t] === dayBenefit(opts.day))) score += 1;
  if (tags.some((t) => prev.has(t))) score -= 2;
  return score;
}
