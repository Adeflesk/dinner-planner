import type { MacroSet } from './types';

export type MacroStatus = 'ok' | 'over' | 'under';
const KEYS = ['kcal', 'protein', 'carbs', 'fat'] as const;
const ZERO: MacroSet = { kcal: 0, protein: 0, carbs: 0, fat: 0 };

export function weeklyTargetFor(personDinnerTargets: MacroSet[], days = 7): MacroSet {
  const perNight = personDinnerTargets.reduce(
    (acc, t) => ({
      kcal: acc.kcal + t.kcal, protein: acc.protein + t.protein,
      carbs: acc.carbs + t.carbs, fat: acc.fat + t.fat,
    }),
    ZERO,
  );
  return { kcal: perNight.kcal * days, protein: perNight.protein * days,
           carbs: perNight.carbs * days, fat: perNight.fat * days };
}

export function weeklyTally(
  nightlyHouseholdTotals: MacroSet[],
  weeklyTarget: MacroSet,
): { totals: MacroSet; status: Record<(typeof KEYS)[number], MacroStatus> } {
  const totals = nightlyHouseholdTotals.reduce(
    (acc, m) => ({
      kcal: acc.kcal + m.kcal, protein: acc.protein + m.protein,
      carbs: acc.carbs + m.carbs, fat: acc.fat + m.fat,
    }),
    ZERO,
  );
  const status = Object.fromEntries(
    KEYS.map((k) => {
      const ratio = weeklyTarget[k] === 0 ? 1 : totals[k] / weeklyTarget[k];
      return [k, ratio > 1.1 ? 'over' : ratio < 0.9 ? 'under' : 'ok'];
    }),
  ) as Record<(typeof KEYS)[number], MacroStatus>;
  return { totals, status };
}
