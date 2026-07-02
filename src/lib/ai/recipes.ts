import { generateObject, gateway } from 'ai';
import type { MacroSet } from '@/lib/macro/types';
import { energyConsistent, violatesAllergies } from '@/lib/macro/validate';
import { aiRecipeSchema, macroEstimateSchema, type AiRecipe, type MacroEstimate } from './schema';

const MODEL = () => process.env.AI_MODEL ?? 'anthropic/claude-haiku-4.5';
const TIMEOUT_MS = 20_000;

// Steer ingredient names/units toward a canonical form so the shopping-list aggregator
// can actually merge duplicates across recipes (see aggregate.ts UNIT_CANON).
const UNIT_GUIDANCE =
  'For each ingredient use a simple, singular, lowercase name with no brand or descriptor ' +
  'words (e.g. "onion" not "1 medium yellow onion", "chicken breast" not "boneless skinless ' +
  'chicken breasts"). Use only these units: g, kg, ml, l, tbsp, tsp, cup, pcs, clove, can, slice.';

export type RecipeRequest = {
  cuisine: string;
  targetPerServing: MacroSet;
  allergies: string[];
  dislikes: string[];
  dietTags: string[];     // e.g. ['vegetarian']
  avoidNames: string[];   // recent recipe names, for variety
};

export type Generator = (req: RecipeRequest) => Promise<AiRecipe>;

function buildPrompt(req: RecipeRequest): string {
  const t = req.targetPerServing;
  return [
    `Create one family dinner recipe (4 base servings) in ${req.cuisine} cuisine.`,
    `Per-serving macro targets: ~${Math.round(t.kcal)} kcal, ${Math.round(t.protein)}g protein, ${Math.round(t.carbs)}g carbs, ${Math.round(t.fat)}g fat.`,
    // We ask for 10% so typical drift still lands inside energyConsistent's 15% gate.
    `kcal must equal 4*protein + 4*carbs + 9*fat within 10%.`,
    req.allergies.length ? `NEVER include these allergens: ${req.allergies.join(', ')}.` : '',
    req.dislikes.length ? `Do not use: ${req.dislikes.join(', ')}.` : '',
    req.dietTags.length ? `The recipe must be: ${req.dietTags.join(', ')}.` : '',
    req.avoidNames.length ? `Do not suggest any of these recent dinners: ${req.avoidNames.join(', ')}.` : '',
    `Assign each ingredient a realistic supermarket section.`,
    UNIT_GUIDANCE,
  ].filter(Boolean).join('\n');
}

export const aiGenerator: Generator = async (req) => {
  const { object } = await generateObject({
    model: gateway(MODEL()),
    schema: aiRecipeSchema,
    prompt: buildPrompt(req),
    abortSignal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return object;
};

/** Generate one recipe; validates output, retries once, returns null on failure (never throws). */
export async function generateRecipe(
  req: RecipeRequest,
  gen: Generator = aiGenerator,
): Promise<AiRecipe | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const recipe = await gen(req);
      if (!energyConsistent(recipe.perServing)) continue;
      if (violatesAllergies(recipe.ingredients, req.allergies).length > 0) continue;
      return recipe;
    } catch {
      // timeout / network / schema error — retry once, then give up
    }
  }
  return null;
}

export type Estimator = (input: { name: string; servings: number; ingredientLines: string }) => Promise<MacroEstimate>;

export const aiEstimator: Estimator = async (input) => {
  const { object } = await generateObject({
    model: gateway(MODEL()),
    schema: macroEstimateSchema,
    prompt: [
      `Estimate per-serving macros for "${input.name}" (${input.servings} servings) and structure its ingredients.`,
      // We ask for 10% so typical drift still lands inside energyConsistent's 15% gate.
    `kcal must equal 4*protein + 4*carbs + 9*fat within 10%.`,
      `Assign each ingredient a realistic supermarket section.`,
      UNIT_GUIDANCE,
      `Ingredients (one per line, may include quantities):`,
      input.ingredientLines,
    ].join('\n'),
    abortSignal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return object;
};

/** Estimate macros for a user-entered recipe; returns null on failure (never throws). */
export async function estimateRecipe(
  input: { name: string; servings: number; ingredientLines: string },
  est: Estimator = aiEstimator,
): Promise<MacroEstimate | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const e = await est(input);
      if (energyConsistent(e.perServing)) return e;
    } catch { /* retry once */ }
  }
  return null;
}
