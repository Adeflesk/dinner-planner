/** Monday (YYYY-MM-DD, UTC) of the week containing `now`. */
export function currentWeekStart(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = d.getUTCDay(); // 0 = Sunday
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

/** Monday (YYYY-MM-DD, UTC) of the week AFTER the one containing `now`. */
export function nextWeekStart(now: Date = new Date()): string {
  const d = new Date(`${currentWeekStart(now)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10);
}

/**
 * Trust boundary for the two-week window: the raw `?week=` value (from a URL
 * or a form field) resolves to exactly one of two legal Mondays. Only the
 * literal 'next' selects next week; anything else is the current week, so a
 * crafted request can never create week rows at arbitrary dates.
 */
export function resolveWeekStart(param: string | undefined, now: Date = new Date()): string {
  return param === 'next' ? nextWeekStart(now) : currentWeekStart(now);
}

export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
