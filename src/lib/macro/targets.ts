import type { ActivityLevel, Goal, MacroSet, PersonProfile } from './types';

const ACTIVITY: Record<ActivityLevel, number> = {
  sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9,
};
const GOAL: Record<Goal, number> = { lose: 0.85, maintain: 1, gain: 1.1 };

export function bmr(p: Pick<PersonProfile, 'age' | 'sex' | 'weightKg' | 'heightCm'>): number {
  return 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age + (p.sex === 'male' ? 5 : -161);
}

export function dailyTargets(p: PersonProfile): MacroSet {
  const kcal = bmr(p) * ACTIVITY[p.activity] * GOAL[p.goal];
  const protein = 1.8 * p.weightKg;
  const fat = (kcal * 0.25) / 9;
  const carbs = Math.max(0, (kcal - protein * 4 - fat * 9) / 4);
  return { kcal, protein, carbs, fat };
}

export function dinnerTargets(p: PersonProfile, share = 0.35): MacroSet {
  const d = dailyTargets(p);
  return {
    kcal: d.kcal * share,
    protein: d.protein * share,
    carbs: d.carbs * share,
    fat: d.fat * share,
  };
}
