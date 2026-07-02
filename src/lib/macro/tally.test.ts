import { describe, expect, it } from 'vitest';
import { weeklyTally, weeklyTargetFor } from './tally';
import type { MacroSet } from './types';

const night: MacroSet = { kcal: 2000, protein: 120, carbs: 200, fat: 70 };

describe('weeklyTargetFor', () => {
  it('sums per-person dinner targets across people and days', () => {
    const a: MacroSet = { kcal: 900, protein: 50, carbs: 90, fat: 25 };
    const b: MacroSet = { kcal: 500, protein: 30, carbs: 50, fat: 15 };
    const t = weeklyTargetFor([a, b], 7);
    expect(t.kcal).toBe((900 + 500) * 7);
    expect(t.protein).toBe(80 * 7);
  });
});

describe('weeklyTally', () => {
  it('sums nights and marks each macro ok within 10%', () => {
    const target = weeklyTargetFor([night], 7); // exactly 7 nights of `night`
    const { totals, status } = weeklyTally(Array(7).fill(night), target);
    expect(totals.kcal).toBe(14000);
    expect(status).toEqual({ kcal: 'ok', protein: 'ok', carbs: 'ok', fat: 'ok' });
  });
  it('marks over and under outside 10%', () => {
    const target: MacroSet = { kcal: 14000, protein: 840, carbs: 1400, fat: 490 };
    const { status } = weeklyTally(
      Array(7).fill({ kcal: 2500, protein: 60, carbs: 200, fat: 70 }),
      target,
    );
    expect(status.kcal).toBe('over');   // 17500 / 14000 = 1.25
    expect(status.protein).toBe('under'); // 420 / 840 = 0.5
    expect(status.carbs).toBe('ok');    // 1400 / 1400
  });
});
