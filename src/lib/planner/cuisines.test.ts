import { describe, expect, it } from 'vitest';
import { DEFAULT_CUISINES, cuisineSequence, effectiveCuisines } from './cuisines';

const counts = (seq: string[]) => {
  const m = new Map<string, number>();
  for (const c of seq) m.set(c, (m.get(c) ?? 0) + 1);
  return [...m.values()].sort((a, b) => b - a);
};

describe('effectiveCuisines', () => {
  it('returns the configured list when it has entries', () => {
    expect(effectiveCuisines(['Thai', 'Greek'])).toEqual(['Thai', 'Greek']);
  });
  it('falls back to the defaults when the list is empty', () => {
    expect(effectiveCuisines([])).toEqual([...DEFAULT_CUISINES]);
  });
  it('falls back when the list is only blanks', () => {
    expect(effectiveCuisines(['', '   '])).toEqual([...DEFAULT_CUISINES]);
  });
  it('trims and dedupes case-insensitively, keeping the first spelling', () => {
    expect(effectiveCuisines([' Thai ', 'thai', 'THAI', 'Greek'])).toEqual(['Thai', 'Greek']);
  });
  it('returns a copy, so callers cannot mutate the defaults', () => {
    const a = effectiveCuisines([]);
    a.push('Martian');
    expect(effectiveCuisines([])).toEqual([...DEFAULT_CUISINES]);
  });
});

describe('cuisineSequence', () => {
  it('never emits the placeholder "any"', () => {
    expect(cuisineSequence([], 7, () => 0)).not.toContain('any');
  });

  it('draws seven distinct cuisines from the defaults', () => {
    const seq = cuisineSequence([], 7, () => 0);
    expect(seq).toHaveLength(7);
    expect(new Set(seq).size).toBe(7);
    for (const c of seq) expect(DEFAULT_CUISINES).toContain(c);
  });

  it('deals balanced counts: no two cuisines differ by more than one', () => {
    for (const size of [2, 3, 4, 5]) {
      const source = Array.from({ length: size }, (_, i) => `c${i}`);
      const c = counts(cuisineSequence(source, 7, () => 0.5));
      expect(c[0] - c[c.length - 1]).toBeLessThanOrEqual(1);
    }
  });

  it('never schedules the same cuisine on adjacent days with 2+ cuisines', () => {
    for (const seed of [0, 0.25, 0.5, 0.99]) {
      const seq = cuisineSequence(['indian', 'mexican', 'italian'], 7, () => seed);
      for (let i = 1; i < seq.length; i++) expect(seq[i]).not.toBe(seq[i - 1]);
    }
  });

  it('fills every slot with the only cuisine when just one is configured', () => {
    expect(cuisineSequence(['italian'], 3, () => 0)).toEqual(['italian', 'italian', 'italian']);
  });

  it('is deterministic for a given rng', () => {
    const a = cuisineSequence([], 7, () => 0.3);
    const b = cuisineSequence([], 7, () => 0.3);
    expect(a).toEqual(b);
  });

  it('orders differently for different rng draws', () => {
    const a = cuisineSequence([], 7, () => 0);
    const b = cuisineSequence([], 7, () => 0.99);
    expect(a).not.toEqual(b);
  });

  it('returns an empty sequence for a non-positive length', () => {
    expect(cuisineSequence(['thai'], 0, () => 0)).toEqual([]);
  });
});
