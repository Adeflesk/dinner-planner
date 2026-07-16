import { describe, expect, it } from 'vitest';
import { currentWeekStart, nextWeekStart, resolveWeekStart } from './dates';

describe('currentWeekStart', () => {
  it('returns the Monday of the week containing the given date', () => {
    expect(currentWeekStart(new Date('2026-06-11T10:00:00Z'))).toBe('2026-06-08'); // Thu → Mon
    expect(currentWeekStart(new Date('2026-06-08T00:00:00Z'))).toBe('2026-06-08'); // Mon → same
    expect(currentWeekStart(new Date('2026-06-14T23:00:00Z'))).toBe('2026-06-08'); // Sun → prev Mon
  });
});

describe('nextWeekStart', () => {
  it('returns the Monday after the current week', () => {
    expect(nextWeekStart(new Date('2026-07-08T10:00:00Z'))).toBe('2026-07-13'); // Wed → next Mon
    expect(nextWeekStart(new Date('2026-07-06T00:00:00Z'))).toBe('2026-07-13'); // Mon → next Mon
    expect(nextWeekStart(new Date('2026-07-12T23:00:00Z'))).toBe('2026-07-13'); // Sun → tomorrow
  });
  it('crosses year boundaries correctly', () => {
    expect(nextWeekStart(new Date('2026-12-31T12:00:00Z'))).toBe('2027-01-04'); // Thu → Mon in new year
  });
});

describe('resolveWeekStart', () => {
  const now = new Date('2026-07-08T10:00:00Z'); // Wed; current week 2026-07-06
  it("maps 'next' to next week's Monday", () => {
    expect(resolveWeekStart('next', now)).toBe('2026-07-13');
  });
  it('maps undefined to the current week', () => {
    expect(resolveWeekStart(undefined, now)).toBe('2026-07-06');
  });
  it('maps garbage and hand-typed dates to the current week', () => {
    expect(resolveWeekStart('2031-01-06', now)).toBe('2026-07-06');
    expect(resolveWeekStart('lol', now)).toBe('2026-07-06');
    expect(resolveWeekStart('', now)).toBe('2026-07-06');
    expect(resolveWeekStart('null', now)).toBe('2026-07-06');
  });
});
