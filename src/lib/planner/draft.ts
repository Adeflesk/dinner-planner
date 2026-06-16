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

  // Phase 2: generate every AI dinner concurrently. This is the only slow part —
  // running the calls in parallel turns ~N×latency into ~1×latency.
  const aiResults = await Promise.all(
    aiSlots.map((slot) =>
      opts.generate({ cuisine: slot.cuisine, dietTags: slot.dietTags, avoidNames: [...used] }),
    ),
  );

  // Phase 3 (no I/O): assemble in day order, de-duplicating names (parallel calls can't
  // see each other) and falling back to an unused favourite when AI failed or collided.
  for (let i = 0; i < aiSlots.length; i++) {
    const slot = aiSlots[i];
    const ai = aiResults[i];
    let dinner: DraftDinner | null = null;
    if (ai && !used.has(ai.name.toLowerCase())) {
      dinner = { day: slot.day, source: 'ai', recipe: ai };
    } else {
      const fav =
        pickFavourite(opts.favourites, slot.cuisine, used, slot.dietTags) ??
        pickFavourite(opts.favourites, null, used, []); // last resort: any unused favourite
      if (fav) dinner = { day: slot.day, source: 'favourite', recipeId: fav.id, recipe: fav };
    }
    if (dinner) {
      used.add(dinner.recipe.name.toLowerCase());
      result[slot.day] = dinner;
    }
    // Still null (no favourites left + AI unavailable) → day stays empty; the UI shows
    // an empty slot and the user can retry.
  }

  return result.filter((d): d is DraftDinner => d !== null);
}
