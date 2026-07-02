import { describe, expect, it } from 'vitest';
import { bmr, dailyTargets, dinnerTargets } from './targets';
import type { PersonProfile } from './types';

const dad: PersonProfile = {
  id: '1', name: 'Dad', age: 40, sex: 'male', weightKg: 80, heightCm: 180,
  activity: 'moderate', goal: 'maintain', allergies: [], dislikes: [],
};

describe('bmr (Mifflin-St Jeor)', () => {
  it('computes male BMR', () => {
    // 10*80 + 6.25*180 - 5*40 + 5 = 1730
    expect(bmr(dad)).toBeCloseTo(1730);
  });
  it('computes female BMR', () => {
    // 10*65 + 6.25*165 - 5*38 - 161 = 1330.25
    expect(bmr({ ...dad, sex: 'female', weightKg: 65, heightCm: 165, age: 38 })).toBeCloseTo(1330.25);
  });
});

describe('dailyTargets', () => {
  it('applies activity multiplier and macro split', () => {
    const t = dailyTargets(dad);
    expect(t.kcal).toBeCloseTo(1730 * 1.55); // 2681.5
    expect(t.protein).toBeCloseTo(144); // 1.8 g/kg
    expect(t.fat).toBeCloseTo((2681.5 * 0.25) / 9, 1);
    expect(t.carbs).toBeCloseTo((2681.5 - 144 * 4 - t.fat * 9) / 4, 1);
  });
  it('adjusts calories for goal', () => {
    expect(dailyTargets({ ...dad, goal: 'lose' }).kcal).toBeCloseTo(2681.5 * 0.85);
    expect(dailyTargets({ ...dad, goal: 'gain' }).kcal).toBeCloseTo(2681.5 * 1.1);
  });
  it('never returns negative carbs', () => {
    const tiny = { ...dad, weightKg: 200, activity: 'sedentary' as const, goal: 'lose' as const };
    expect(dailyTargets(tiny).carbs).toBeGreaterThanOrEqual(0);
  });
});

describe('dinnerTargets', () => {
  it('scales daily targets by the dinner share', () => {
    const d = dailyTargets(dad);
    const t = dinnerTargets(dad, 0.35);
    expect(t.kcal).toBeCloseTo(d.kcal * 0.35);
    expect(t.protein).toBeCloseTo(d.protein * 0.35);
  });
});
