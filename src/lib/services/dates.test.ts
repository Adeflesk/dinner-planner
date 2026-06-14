import { describe, expect, it } from 'vitest';
import { currentWeekStart } from './dates';

describe('currentWeekStart', () => {
  it('returns the Monday of the week containing the given date', () => {
    expect(currentWeekStart(new Date('2026-06-11T10:00:00Z'))).toBe('2026-06-08'); // Thu → Mon
    expect(currentWeekStart(new Date('2026-06-08T00:00:00Z'))).toBe('2026-06-08'); // Mon → same
    expect(currentWeekStart(new Date('2026-06-14T23:00:00Z'))).toBe('2026-06-08'); // Sun → prev Mon
  });
});
