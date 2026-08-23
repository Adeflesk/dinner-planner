// Cuisine policy for the weekly draft: which cuisines are in play, and in what
// order the seven nights get them. Pure and dependency-free, like the macro
// engine — no I/O, no randomness beyond the injected rng.

/**
 * Used when the household has not set any preferred cuisines. Eight entries, so
 * a seven-night week draws seven distinct cuisines and no single cuisine can
 * dominate. The Family page overrides this whenever it is filled in.
 */
export const DEFAULT_CUISINES = [
  'Italian', 'Thai', 'Indian', 'Mexican',
  'Japanese', 'Greek', 'Middle Eastern', 'British',
] as const satisfies readonly string[];

const norm = (s: string) => s.trim().toLowerCase();

/**
 * The cuisine list actually in play: the household's own, cleaned up, or the
 * defaults when they have configured none. Exported separately because draftWeek
 * needs the size of this list to size its per-cuisine cap, and must not have to
 * guess whether the defaults were substituted.
 */
export function effectiveCuisines(configured: string[]): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of configured) {
    const trimmed = raw.trim();
    if (!trimmed || seen.has(norm(trimmed))) continue;
    seen.add(norm(trimmed));
    cleaned.push(trimmed);
  }
  return cleaned.length > 0 ? cleaned : [...DEFAULT_CUISINES];
}

function shuffle(items: string[], rng: () => number): string[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * A cuisine for each of `length` nights. Counts are balanced (any two differ by
 * at most one) and no cuisine falls on adjacent nights unless the household
 * configured only one. Never returns a placeholder — every slot names a real
 * cuisine, so the AI prompt is never the bare "any cuisine" that collapses the
 * model onto one style of food.
 */
export function cuisineSequence(
  configured: string[],
  length: number,
  rng: () => number = Math.random,
): string[] {
  if (length <= 0) return [];
  const order = shuffle(effectiveCuisines(configured), rng);

  // Balanced quota: the first `length % order.length` cuisines get one extra night.
  const remaining = new Map<string, number>();
  for (let i = 0; i < order.length; i++) {
    const quota = Math.floor(length / order.length) + (i < length % order.length ? 1 : 0);
    if (quota > 0) remaining.set(order[i], quota);
  }

  // Greedy arrangement: at each slot take the cuisine with the most nights left
  // that is not the previous night's. Balanced quotas keep the largest count at
  // or below ceil(length/2), which is exactly when this never paints itself into
  // a corner (with 2+ cuisines).
  const seq: string[] = [];
  let last = '';
  for (let i = 0; i < length; i++) {
    let best = '';
    for (const [cuisine, left] of remaining) {
      if (left <= 0 || cuisine === last) continue;
      if (best === '' || left > (remaining.get(best) ?? 0)) best = cuisine;
    }
    // Only the previous night's cuisine has nights left — a single-cuisine
    // household, where repeating is the correct answer.
    if (best === '') best = last;
    seq.push(best);
    remaining.set(best, (remaining.get(best) ?? 0) - 1);
    last = best;
  }
  return seq;
}
