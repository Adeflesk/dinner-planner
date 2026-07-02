import { describe, expect, it } from 'vitest';
import {
  CAPABILITIES, STANDOUT, dayBenefit, standoutTags, lacksEquipment, scoreFavourite,
} from './equipment';

describe('vocabulary', () => {
  it('has the 8 closed-set capabilities', () => {
    expect([...CAPABILITIES]).toEqual([
      'steam', 'combi-steam', 'microwave', 'convection',
      'grill/broil', 'induction-hob', 'air-fry', 'sous-vide',
    ]);
  });
  it('marks only premium gear as standout', () => {
    expect([...STANDOUT]).toEqual(['steam', 'combi-steam', 'sous-vide', 'air-fry']);
  });
});

describe('dayBenefit', () => {
  it('leans speed Mon–Thu (days 0–3)', () => {
    expect([0, 1, 2, 3].map(dayBenefit)).toEqual(['speed', 'speed', 'speed', 'speed']);
  });
  it('leans quality Fri–Sun (days 4–6)', () => {
    expect([4, 5, 6].map(dayBenefit)).toEqual(['quality', 'quality', 'quality']);
  });
});

describe('standoutTags', () => {
  it('returns only standout tags, case-insensitive and deduped', () => {
    expect(standoutTags(['Steam', 'convection', 'steam', 'air-fry']).sort())
      .toEqual(['air-fry', 'steam']);
  });
  it('returns empty for baseline-only equipment', () => {
    expect(standoutTags(['convection', 'induction-hob'])).toEqual([]);
  });
});

describe('lacksEquipment', () => {
  it('lists capabilities the household does not have (case-insensitive)', () => {
    expect(lacksEquipment(['Sous-Vide', 'steam'], ['steam', 'convection'])).toEqual(['sous-vide']);
  });
  it('returns empty when the recipe needs nothing extra', () => {
    expect(lacksEquipment([], ['steam'])).toEqual([]);
    expect(lacksEquipment(['steam'], ['steam', 'air-fry'])).toEqual([]);
  });
});

describe('scoreFavourite', () => {
  const have = ['steam', 'air-fry']; // household with one quality + one speed appliance

  it('scores 0 for a recipe using no standout gear the household has', () => {
    expect(scoreFavourite({ equipment: ['convection'] }, { day: 0, household: have, prevStandout: [] })).toBe(0);
  });
  it('gives +2 for using standout gear, +1 more when benefit fits the day', () => {
    // air-fry = speed; day 0 is a weeknight (speed) → 2 + 1
    expect(scoreFavourite({ equipment: ['air-fry'] }, { day: 0, household: have, prevStandout: [] })).toBe(3);
    // steam = quality on a weeknight → 2 + 0
    expect(scoreFavourite({ equipment: ['steam'] }, { day: 0, household: have, prevStandout: [] })).toBe(2);
    // steam = quality on a weekend (day 5) → 2 + 1
    expect(scoreFavourite({ equipment: ['steam'] }, { day: 5, household: have, prevStandout: [] })).toBe(3);
  });
  it("penalises repeating last night's standout method", () => {
    // steam again right after a steam night: 2 + 0 (weeknight) - 2 = 0
    expect(scoreFavourite({ equipment: ['steam'] }, { day: 1, household: have, prevStandout: ['steam'] })).toBe(0);
  });
  it('ignores standout gear the household does not actually have', () => {
    expect(scoreFavourite({ equipment: ['sous-vide'] }, { day: 0, household: have, prevStandout: [] })).toBe(0);
  });
});
