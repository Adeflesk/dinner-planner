import type { MacroSet } from './types';

export type PortionInput = { personId: string; target: MacroSet };
export type Portion = {
  personId: string;
  servings: number;
  achieved: MacroSet;
  withinTolerance: boolean;
};

const STEP = 0.25;
const MIN = 0.5;
const MAX = 3;
const TOLERANCE = 0.1;

export function scale(m: MacroSet, factor: number): MacroSet {
  return {
    kcal: m.kcal * factor,
    protein: m.protein * factor,
    carbs: m.carbs * factor,
    fat: m.fat * factor,
  };
}

export function solvePortions(
  perServing: MacroSet,
  targets: PortionInput[],
): { portions: Portion[]; householdServings: number } {
  const portions = targets.map(({ personId, target }) => {
    const raw = target.kcal / perServing.kcal;
    const servings = Math.min(MAX, Math.max(MIN, Math.round(raw / STEP) * STEP));
    const achieved = scale(perServing, servings);
    const withinTolerance =
      Math.abs(achieved.kcal - target.kcal) / target.kcal <= TOLERANCE;
    return { personId, servings, achieved, withinTolerance };
  });
  return {
    portions,
    householdServings: portions.reduce((sum, p) => sum + p.servings, 0),
  };
}
