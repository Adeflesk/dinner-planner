export type MacroSet = { kcal: number; protein: number; carbs: number; fat: number };

export type Sex = 'male' | 'female';
export type Goal = 'lose' | 'maintain' | 'gain';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
export type StoreSection = 'produce' | 'meat_fish' | 'dairy' | 'pantry' | 'frozen' | 'other';

export type PersonProfile = {
  id: string;
  name: string;
  age: number;
  sex: Sex;
  weightKg: number;
  heightCm: number;
  activity: ActivityLevel;
  goal: Goal;
  allergies: string[];
  dislikes: string[];
};

export type Ingredient = {
  name: string;
  quantity: number;
  unit: string;
  section: StoreSection;
};

export type RecipeData = {
  name: string;
  cuisine: string;
  method: string;
  servings: number;
  perServing: MacroSet;
  tags: string[];
  equipment: string[];
  ingredients: Ingredient[];
};
