import { z } from 'zod';

export const macroSetSchema = z.object({
  kcal: z.number(), protein: z.number(), carbs: z.number(), fat: z.number(),
});

export const ingredientSchema = z.object({
  name: z.string(),
  quantity: z.number(),
  unit: z.string(),
  section: z.enum(['produce', 'meat_fish', 'dairy', 'pantry', 'frozen', 'other']),
});

export const aiRecipeSchema = z.object({
  name: z.string(),
  cuisine: z.string(),
  method: z.string(),
  servings: z.number().int().positive(),
  perServing: macroSetSchema,
  tags: z.array(z.string()),
  ingredients: z.array(ingredientSchema).min(1),
});
export type AiRecipe = z.infer<typeof aiRecipeSchema>;

export const macroEstimateSchema = z.object({
  perServing: macroSetSchema,
  ingredients: z.array(ingredientSchema).min(1),
});
export type MacroEstimate = z.infer<typeof macroEstimateSchema>;
