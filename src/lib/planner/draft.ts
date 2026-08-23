import type { RecipeData } from '@/lib/macro/types';
import type { AiRecipe } from '@/lib/ai/schema';
import { scoreFavourite, standoutTags, dayBenefit, type Benefit } from '@/lib/macro/equipment';
import { cuisineSequence, effectiveCuisines } from './cuisines';

export type FavouriteRecipe = RecipeData & { id: string };
export type DraftDinner = {
  day: number;                 // 0 = Monday … 6 = Sunday
  source: 'favourite' | 'ai';
  recipeId?: string;           // set for favourites (existing DB row)
  recipe: RecipeData;
};

export type DraftGenerateRequest = {
  day: number;
  cuisine: string;
  dietTags: string[];
  avoidNames: string[];
  preferBenefit: Benefit;
};

/**
 * Which of `availableDays` should be vegetarian. The days are cut into `count`
 * equal buckets and one day is drawn from each, so the nights stay spread out
 * however the rng falls — assigning them front-to-back would always land them
 * on Mon/Tue/Wed.
 */
export function vegetarianDays(
  availableDays: number[],
  count: number,
  rng: () => number = Math.random,
): Set<number> {
  if (count <= 0) return new Set();
  if (count >= availableDays.length) return new Set(availableDays);
  const picked = new Set<number>();
  for (let i = 0; i < count; i++) {
    const start = Math.floor((i * availableDays.length) / count);
    const end = Math.floor(((i + 1) * availableDays.length) / count);
    picked.add(availableDays[start + Math.floor(rng() * (end - start))]);
  }
  return picked;
}

function pickFavourite(
  favourites: FavouriteRecipe[],
  cuisine: string | null,
  used: Set<string>,
  dietTags: string[],
  bias: { day: number; household: string[]; prevStandout: string[] },
): FavouriteRecipe | null {
  const fresh = favourites.filter(
    (f) =>
      !used.has(f.name.toLowerCase()) &&
      dietTags.every((t) => f.tags.includes(t)) &&
      (cuisine === null || cuisine === 'any' || f.cuisine.toLowerCase() === cuisine.toLowerCase()),
  );
  if (fresh.length === 0) return null;
  // Stable sort by descending bias score; ties keep insertion order (preserves the
  // old "first match" behaviour when no equipment signal applies).
  return [...fresh]
    .map((f, i) => ({ f, i, s: scoreFavourite(f, bias) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)[0].f;
}

/**
 * What happened to one night's slot. draftWeek is pure and must not log, so it
 * reports through an injected callback the way it already takes an injected
 * generator; the service layer decides what to do with these.
 */
export type DraftEvent =
  | { type: 'ai-collision'; day: number; reason: 'duplicate-name' | 'cuisine-cap'; name: string }
  | { type: 'ai-empty'; day: number }
  | { type: 'fallback-favourite'; day: number; name: string }
  | { type: 'gap'; day: number };

export async function draftWeek(opts: {
  favourites: FavouriteRecipe[];
  cuisines: string[];
  recentNames: string[];
  pinned: Map<number, DraftDinner>;
  vegetarianNights: number;
  equipment?: string[];
  generate: (req: DraftGenerateRequest) => Promise<AiRecipe | null>;
  onEvent?: (event: DraftEvent) => void;
  rng?: () => number;
}): Promise<DraftDinner[]> {
  const seq = cuisineSequence(opts.cuisines, 7, opts.rng);
  const used = new Set(opts.recentNames.map((n) => n.toLowerCase()));
  for (const p of opts.pinned.values()) used.add(p.recipe.name.toLowerCase());
  const household = opts.equipment ?? [];
  const emit = opts.onEvent ?? (() => {});

  // Variety guard: the generator is *asked* for a cuisine but self-reports whatever
  // it likes, so the sequence's balance guarantees nothing on its own. Cap each
  // cuisine at the same share the sequence promises, and count pinned and favourite
  // dinners toward it so the AI slots see an accurate picture.
  const cuisineNorm = (c: string) => c.trim().toLowerCase();
  const allowedPerCuisine = Math.ceil(7 / effectiveCuisines(opts.cuisines).length);
  const cuisineCount = new Map<string, number>();
  const countCuisine = (c: string) => {
    const k = cuisineNorm(c);
    cuisineCount.set(k, (cuisineCount.get(k) ?? 0) + 1);
  };
  const atCap = (c: string) => (cuisineCount.get(cuisineNorm(c)) ?? 0) >= allowedPerCuisine;
  for (const p of opts.pinned.values()) countCuisine(p.recipe.cuisine);

  // Vegetarian nights are chosen up front, and only from days that aren't pinned —
  // a pinned day keeps whatever dinner it already has, so spending the quota on one
  // would silently lose a vegetarian night.
  const unpinnedDays: number[] = [];
  for (let day = 0; day < 7; day++) if (!opts.pinned.has(day)) unpinnedDays.push(day);
  const vegDays = vegetarianDays(unpinnedDays, opts.vegetarianNights, opts.rng);

  const result: (DraftDinner | null)[] = new Array(7).fill(null);
  const aiSlots: { day: number; cuisine: string; dietTags: string[] }[] = [];

  // Phase 1 (no I/O): place pinned and favourite dinners, collect the days needing AI.
  for (let day = 0; day < 7; day++) {
    const pinnedDinner = opts.pinned.get(day);
    if (pinnedDinner) { result[day] = pinnedDinner; continue; }

    const cuisine = seq[day];
    const dietTags = vegDays.has(day) ? ['vegetarian'] : [];
    const prev = day > 0 ? result[day - 1] : null;
    const prevStandout = prev ? standoutTags(prev.recipe.equipment) : [];
    const wantFavourite = day % 2 === 0; // ~half favourites, half AI
    const favMatch = pickFavourite(opts.favourites, cuisine, used, dietTags, { day, household, prevStandout });

    if (wantFavourite && favMatch) {
      result[day] = { day, source: 'favourite', recipeId: favMatch.id, recipe: favMatch };
      used.add(favMatch.name.toLowerCase());
      countCuisine(favMatch.cuisine);
    } else {
      aiSlots.push({ day, cuisine, dietTags });
    }
  }

  // Phase 2: generate AI dinners concurrently (the only slow part — parallel calls turn
  // ~N×latency into ~1×latency). Retry slots that came back empty (null or name-collision),
  // but stop the moment a whole round makes no progress — that means AI is down, and
  // retrying would just burn another round of timeouts.
  let pending = aiSlots;
  for (let round = 0; round < 2 && pending.length > 0; round++) {
    const results = await Promise.all(
      pending.map((slot) =>
        opts.generate({
          day: slot.day, cuisine: slot.cuisine, dietTags: slot.dietTags,
          avoidNames: [...used], preferBenefit: dayBenefit(slot.day),
        }),
      ),
    );
    const stillPending: typeof pending = [];
    for (let i = 0; i < pending.length; i++) {
      const slot = pending[i];
      const ai = results[i];
      // The cap applies on the first pass only. On the last pass a monotonous
      // dinner beats an empty night, so anything that is not a duplicate is taken.
      const overCap = round === 0 && ai !== null && atCap(ai.cuisine);
      if (ai && !used.has(ai.name.toLowerCase()) && !overCap) {
        used.add(ai.name.toLowerCase());
        countCuisine(ai.cuisine);
        result[slot.day] = { day: slot.day, source: 'ai', recipe: ai };
      } else {
        if (ai === null) {
          emit({ type: 'ai-empty', day: slot.day });
        } else {
          emit({
            type: 'ai-collision', day: slot.day, name: ai.name,
            reason: overCap ? 'cuisine-cap' : 'duplicate-name',
          });
        }
        stillPending.push(slot);
      }
    }
    pending = stillPending;
    // Stop only when AI produced nothing at all — that means it is down, and
    // retrying would burn another round of timeouts. A round that produced
    // recipes but rejected them (duplicate names, over-cap cuisines) HAS made
    // progress worth retrying: the next round sees an updated avoid list.
    if (results.every((r) => r === null)) break;
  }

  // Phase 3 (no I/O): fill any day AI never managed with an unused favourite. A day with
  // no AI result and no spare favourite stays empty — the UI shows a gap and a swap button.
  for (const slot of pending) {
    const prev = slot.day > 0 ? result[slot.day - 1] : null;
    const prevStandout = prev ? standoutTags(prev.recipe.equipment) : [];
    const bias = { day: slot.day, household, prevStandout };
    const fav =
      pickFavourite(opts.favourites, slot.cuisine, used, slot.dietTags, bias) ??
      pickFavourite(opts.favourites, null, used, [], bias);
    if (fav) {
      used.add(fav.name.toLowerCase());
      countCuisine(fav.cuisine);
      result[slot.day] = { day: slot.day, source: 'favourite', recipeId: fav.id, recipe: fav };
      emit({ type: 'fallback-favourite', day: slot.day, name: fav.name });
    } else {
      emit({ type: 'gap', day: slot.day });
    }
  }

  return result.filter((d): d is DraftDinner => d !== null);
}
