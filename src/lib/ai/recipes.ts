import { generateObject, gateway } from 'ai';
import type { MacroSet } from '@/lib/macro/types';
import { energyConsistent, violatesAllergies } from '@/lib/macro/validate';
import { CAPABILITIES, lacksEquipment, type Benefit } from '@/lib/macro/equipment';
import { aiRecipeSchema, macroEstimateSchema, type AiRecipe, type MacroEstimate } from './schema';

const MODEL = () => process.env.AI_MODEL ?? 'anthropic/claude-haiku-4.5';
const TIMEOUT_MS = 20_000;

// Steer ingredient names/units toward a canonical form so the shopping-list aggregator
// can actually merge duplicates across recipes (see aggregate.ts UNIT_CANON and canon.ts).
const UNIT_GUIDANCE =
  'For each ingredient use a simple, singular, lowercase name with no brand or descriptor ' +
  'words (e.g. "onion" not "1 medium yellow onion", "chicken breast" not "boneless skinless ' +
  'chicken breasts"). Use only these units: g, kg, ml, l, tbsp, tsp, cup, pcs, clove, can, slice. ' +
  'Measure whole produce in pcs, not grams (e.g. "2 pcs onion", "1 pcs bell pepper"); use clove ' +
  'for garlic. Use one canonical name per ingredient: "green onion" not "scallion" or ' +
  '"spring onion", "cilantro" not "fresh coriander", "bell pepper" not "capsicum".';

// Make the method actually exploit the gear rather than name-drop it. Steam-oven
// moisture control IS the feature; pure steam caps at 100°C; the oven is one cavity;
// "grill" is the oven's overhead element, not a barbecue.
const EQUIPMENT_GUIDANCE =
  'Where it improves the dish, write method steps that use these appliances. For ' +
  'steam or combi-steam give Miele-style program steps including the moisture/humidity ' +
  '%, e.g. "Combi Steam, 160°C, 60% moisture". Pure steam never exceeds 100°C; only ' +
  'combi modes go higher. The oven has a single cavity — do not run two oven programs ' +
  'at once; sequence steps or use the hob for sides. "grill" means the oven\'s overhead ' +
  'grill element, not an outdoor barbecue.';

export type RecipeRequest = {
  cuisine: string;
  targetPerServing: MacroSet;
  allergies: string[];
  dislikes: string[];
  dietTags: string[];      // e.g. ['vegetarian']
  avoidNames: string[];    // recent recipe names, for variety
  equipment: string[];     // household capabilities the recipe may use
  preferBenefit: Benefit;  // 'speed' on weeknights, 'quality' on weekends
};

export type Generator = (req: RecipeRequest) => Promise<AiRecipe>;

function buildPrompt(req: RecipeRequest): string {
  const t = req.targetPerServing;
  return [
    `Create one family dinner recipe (4 base servings) in ${req.cuisine} cuisine.`,
    `Per-serving macro targets: ~${Math.round(t.kcal)} kcal, ${Math.round(t.protein)}g protein, ${Math.round(t.carbs)}g carbs, ${Math.round(t.fat)}g fat.`,
    `kcal must equal 4*protein + 4*carbs + 9*fat within 10%.`,
    req.allergies.length ? `NEVER include these allergens: ${req.allergies.join(', ')}.` : '',
    req.dislikes.length ? `Do not use: ${req.dislikes.join(', ')}.` : '',
    req.dietTags.length ? `The recipe must be: ${req.dietTags.join(', ')}.` : '',
    req.avoidNames.length ? `Do not suggest any of these recent dinners: ${req.avoidNames.join(', ')}.` : '',
    req.preferBenefit === 'speed'
      ? `Favour a quick, hands-off, weeknight-friendly method.`
      : `A more involved, quality-focused method is welcome.`,
    req.equipment.length
      ? `The kitchen has these capabilities: ${req.equipment.join(', ')}. ${EQUIPMENT_GUIDANCE}`
      : '',
    req.equipment.length
      ? `In the "equipment" field, list ONLY capabilities you actually used, chosen from: ${req.equipment.join(', ')}. If the recipe needs no special equipment, return an empty array.`
      : `Return an empty "equipment" array.`,
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
      if (lacksEquipment(recipe.equipment, req.equipment).length > 0) continue;
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
      `In the "equipment" field, list any special cooking capabilities the method implies, chosen ONLY from: ${CAPABILITIES.join(', ')}. Use an empty array if none.`,
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
