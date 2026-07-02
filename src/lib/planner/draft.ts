import type { RecipeData } from '@/lib/macro/types';
import type { AiRecipe } from '@/lib/ai/schema';

export type FavouriteRecipe = RecipeData & { id: string };
export type DraftDinner = {
  day: number;                 // 0 = Monday … 6 = Sunday
  source: 'favourite' | 'ai';
  recipeId?: string;           // set for favourites (existing DB row)
  recipe: RecipeData;
};

export type DraftGenerateRequest = { cuisine: string; dietTags: string[]; avoidNames: string[] };

export function cuisineSequence(
  cuisines: string[],
  length: number,
  rng: () => number = Math.random,
): string[] {
  if (cuisines.length === 0) return Array(length).fill('any');
  const seq: string[] = [];
  let last = '';
  for (let i = 0; i < length; i++) {
    let candidates = cuisines.filter((c) => c !== last);
    if (candidates.length === 0) candidates = cuisines; // single-cuisine household
    const pick = candidates[Math.floor(rng() * candidates.length)];
    seq.push(pick);
    last = pick;
  }
  return seq;
}

function pickFavourite(
  favourites: FavouriteRecipe[],
  cuisine: string | null,
  used: Set<string>,
  dietTags: string[],
): FavouriteRecipe | null {
  const fresh = favourites.filter(
    (f) =>
      !used.has(f.name.toLowerCase()) &&
      dietTags.every((t) => f.tags.includes(t)) &&
      (cuisine === null || cuisine === 'any' || f.cuisine.toLowerCase() === cuisine.toLowerCase()),
  );
  return fresh[0] ?? null;
}

export async function draftWeek(opts: {
  favourites: FavouriteRecipe[];
  cuisines: string[];
  recentNames: string[];
  pinned: Map<number, DraftDinner>;
  vegetarianNights: number;
  generate: (req: DraftGenerateRequest) => Promise<AiRecipe | null>;
  rng?: () => number;
}): Promise<DraftDinner[]> {
  const seq = cuisineSequence(opts.cuisines, 7, opts.rng);
  const used = new Set(opts.recentNames.map((n) => n.toLowerCase()));
  for (const p of opts.pinned.values()) used.add(p.recipe.name.toLowerCase());

  let vegRemaining = opts.vegetarianNights;
  const result: (DraftDinner | null)[] = new Array(7).fill(null);
  const aiSlots: { day: number; cuisine: string; dietTags: string[] }[] = [];

  // Phase 1 (no I/O): place pinned and favourite dinners, collect the days needing AI.
  for (let day = 0; day < 7; day++) {
    const pinnedDinner = opts.pinned.get(day);
    if (pinnedDinner) { result[day] = pinnedDinner; continue; }

    const cuisine = seq[day];
    const dietTags = vegRemaining > 0 ? ['vegetarian'] : [];
    const wantFavourite = day % 2 === 0; // ~half favourites, half AI
    const favMatch = pickFavourite(opts.favourites, cuisine, used, dietTags);

    if (wantFavourite && favMatch) {
      result[day] = { day, source: 'favourite', recipeId: favMatch.id, recipe: favMatch };
      used.add(favMatch.name.toLowerCase());
      if (dietTags.length) vegRemaining--; // favMatch is veg (pickFavourite filtered on it)
    } else {
      aiSlots.push({ day, cuisine, dietTags });
      if (dietTags.length) vegRemaining--; // reserve this night as vegetarian
    }
  }

  // Phase 2: generate AI dinners concurrently (the only slow part — parallel calls turn
  // ~N×latency into ~1×latency). Retry slots that came back empty (null or name-collision),
  // but stop the moment a whole round makes no progress — that means AI is down, and
  // retrying would just burn another round of timeouts.
  let pending = aiSlots;
  for (let round = 0; round < 2 && pending.length > 0; round++) {
    const before = pending.length;
    const results = await Promise.all(
      pending.map((slot) =>
        opts.generate({ cuisine: slot.cuisine, dietTags: slot.dietTags, avoidNames: [...used] }),
      ),
    );
    const stillPending: typeof pending = [];
    for (let i = 0; i < pending.length; i++) {
      const slot = pending[i];
      const ai = results[i];
      if (ai && !used.has(ai.name.toLowerCase())) {
        used.add(ai.name.toLowerCase());
        result[slot.day] = { day: slot.day, source: 'ai', recipe: ai };
      } else {
        stillPending.push(slot);
      }
    }
    pending = stillPending;
    if (pending.length === before) break; // no progress → AI unavailable, don't retry
  }

  // Phase 3 (no I/O): fill any day AI never managed with an unused favourite. A day with
  // no AI result and no spare favourite stays empty — the UI shows a gap and a swap button.
  for (const slot of pending) {
    const fav =
      pickFavourite(opts.favourites, slot.cuisine, used, slot.dietTags) ??
      pickFavourite(opts.favourites, null, used, []);
    if (fav) {
      used.add(fav.name.toLowerCase());
      result[slot.day] = { day: slot.day, source: 'favourite', recipeId: fav.id, recipe: fav };
    }
  }

  return result.filter((d): d is DraftDinner => d !== null);
}
