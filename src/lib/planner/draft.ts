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
  const result: DraftDinner[] = [];

  for (let day = 0; day < 7; day++) {
    const pinnedDinner = opts.pinned.get(day);
    if (pinnedDinner) { result.push(pinnedDinner); continue; }

    const cuisine = seq[day];
    const dietTags = vegRemaining > 0 ? ['vegetarian'] : [];
    const wantFavourite = day % 2 === 0; // ~half favourites, half AI
    const favMatch = pickFavourite(opts.favourites, cuisine, used, dietTags);

    let dinner: DraftDinner | null = null;
    if (wantFavourite && favMatch) {
      dinner = { day, source: 'favourite', recipeId: favMatch.id, recipe: favMatch };
    } else {
      const ai = await opts.generate({ cuisine, dietTags, avoidNames: [...used] });
      if (ai && !used.has(ai.name.toLowerCase())) dinner = { day, source: 'ai', recipe: ai };
      else if (favMatch) dinner = { day, source: 'favourite', recipeId: favMatch.id, recipe: favMatch };
    }
    if (!dinner) {
      // last resort: any unused favourite regardless of cuisine/diet
      const any = pickFavourite(opts.favourites, null, used, []);
      if (any) dinner = { day, source: 'favourite', recipeId: any.id, recipe: any };
    }
    if (dinner) {
      used.add(dinner.recipe.name.toLowerCase());
      if (dietTags.length && dinner.recipe.tags.includes('vegetarian')) vegRemaining--;
      result.push(dinner);
    }
    // If still null (no favourites at all + AI down), the day is simply skipped;
    // the UI shows an empty slot and the user can retry.
  }
  return result;
}
