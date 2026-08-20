import { describe, expect, it } from 'vitest';
import { draftWeek, vegetarianDays, type DraftEvent, type FavouriteRecipe } from './draft';
import type { AiRecipe } from '@/lib/ai/schema';

const fav = (name: string, cuisine: string, tags: string[] = []): FavouriteRecipe => ({
  id: `fav-${name}`, name, cuisine, method: '', servings: 4,
  perServing: { kcal: 600, protein: 40, carbs: 55, fat: 20 }, tags, equipment: [],
  ingredients: [{ name: 'x', quantity: 1, unit: 'pcs', section: 'other' }],
});

const favEq = (name: string, cuisine: string, equipment: string[], tags: string[] = []): FavouriteRecipe => ({
  ...fav(name, cuisine, tags), equipment,
});

const aiRecipe = (name: string, cuisine: string, tags: string[] = []): AiRecipe => ({
  name, cuisine, method: 'cook', servings: 4,
  perServing: { kcal: 600, protein: 40, carbs: 55, fat: 20 }, tags, equipment: [],
  ingredients: [{ name: 'y', quantity: 1, unit: 'pcs', section: 'other' }],
});

describe('vegetarianDays', () => {
  const week = [0, 1, 2, 3, 4, 5, 6];
  const sorted = (s: Set<number>) => [...s].sort((a, b) => a - b);

  it('spreads nights across the week instead of clustering them at the start', () => {
    expect(sorted(vegetarianDays(week, 3, () => 0))).toEqual([0, 2, 4]);
  });
  it('jitters the pick within each bucket', () => {
    expect(sorted(vegetarianDays(week, 3, () => 0.99))).toEqual([1, 3, 6]);
  });
  it('returns no nights when the quota is zero', () => {
    expect(vegetarianDays(week, 0, () => 0).size).toBe(0);
  });
  it('marks every available day when the quota meets or exceeds them', () => {
    expect(sorted(vegetarianDays([0, 1, 2], 5, () => 0))).toEqual([0, 1, 2]);
  });
  it('only picks from the days offered, so pinned days keep their dinner', () => {
    const days = vegetarianDays([1, 3, 5], 2, () => 0);
    expect(days.size).toBe(2);
    for (const d of days) expect([1, 3, 5]).toContain(d);
  });
});

describe('draftWeek', () => {
  const favourites = [fav('Tacos', 'mexican'), fav('Curry', 'indian'), fav('Pasta bake', 'italian')];

  it('fills 7 days mixing favourites and AI', async () => {
    // Counter mimics the real generator, which is told avoidNames and returns fresh ideas.
    let n = 0;
    const days = await draftWeek({
      favourites, cuisines: ['mexican', 'indian', 'italian'], recentNames: [],
      pinned: new Map(), vegetarianNights: 0, rng: () => 0,
      generate: async (req) => aiRecipe(`AI ${req.cuisine} ${++n}`, req.cuisine, req.dietTags),
    });
    expect(days).toHaveLength(7);
    expect(days.some((d) => d.source === 'favourite')).toBe(true);
    expect(days.some((d) => d.source === 'ai')).toBe(true);
    const names = days.map((d) => d.recipe.name.toLowerCase());
    expect(new Set(names).size).toBe(7); // no repeats within the week
  });

  it('falls back to favourites only when AI returns null', async () => {
    const days = await draftWeek({
      favourites, cuisines: ['mexican'], recentNames: [],
      pinned: new Map(), vegetarianNights: 0, rng: () => 0,
      generate: async () => null,
    });
    expect(days.every((d) => d.source === 'favourite')).toBe(true);
    expect(days.length).toBeGreaterThan(0);
  });

  it('preserves pinned days', async () => {
    const pinnedDinner = { day: 1, source: 'favourite' as const, recipeId: 'fav-Tacos', recipe: favourites[0] };
    const days = await draftWeek({
      favourites, cuisines: ['indian', 'italian'], recentNames: [],
      pinned: new Map([[1, pinnedDinner]]), vegetarianNights: 0, rng: () => 0,
      generate: async (req) => aiRecipe(`AI ${req.cuisine} ${Math.random()}`, req.cuisine),
    });
    expect(days.find((d) => d.day === 1)).toEqual(pinnedDinner);
  });

  it('avoids recent recipe names', async () => {
    const days = await draftWeek({
      favourites, cuisines: ['mexican', 'indian', 'italian'], recentNames: ['Tacos'],
      pinned: new Map(), vegetarianNights: 0, rng: () => 0,
      generate: async (req) => aiRecipe(`AI ${req.cuisine}`, req.cuisine),
    });
    expect(days.map((d) => d.recipe.name)).not.toContain('Tacos');
  });

  it('requests vegetarian dinners for the configured number of nights', async () => {
    const vegRequests: number[] = [];
    const days = await draftWeek({
      favourites: [], cuisines: ['indian', 'italian'], recentNames: [],
      pinned: new Map(), vegetarianNights: 2, rng: () => 0,
      generate: async (req) => {
        if (req.dietTags.includes('vegetarian')) vegRequests.push(1);
        return aiRecipe(`AI ${req.cuisine} ${req.dietTags.join('')} ${vegRequests.length}`, req.cuisine, req.dietTags);
      },
    });
    expect(days.filter((d) => d.recipe.tags.includes('vegetarian'))).toHaveLength(2);
  });

  it('spreads vegetarian nights across the week rather than stacking them at the front', async () => {
    const days = await draftWeek({
      favourites: [], cuisines: ['indian', 'italian'], recentNames: [],
      pinned: new Map(), vegetarianNights: 3, rng: () => 0,
      generate: async (req) => aiRecipe(`AI ${req.day}`, req.cuisine, req.dietTags),
    });
    const vegDays = days.filter((d) => d.recipe.tags.includes('vegetarian')).map((d) => d.day);
    expect(vegDays).toEqual([0, 2, 4]);
  });

  it('retries slots AI failed to fill (flaky AI), so the week is not left full of gaps', async () => {
    let calls = 0;
    // First 3 generate calls return null; everything after succeeds. With a retry
    // round, the 3 initially-empty days get filled on the second pass.
    const flaky = async (req: { cuisine: string }) => {
      calls++;
      return calls <= 3 ? null : aiRecipe(`AI ${req.cuisine} ${Math.random()}`, req.cuisine);
    };
    const days = await draftWeek({
      favourites: [], cuisines: ['indian', 'italian'], recentNames: [],
      pinned: new Map(), vegetarianNights: 0, rng: () => 0, generate: flaky,
    });
    expect(days).toHaveLength(7); // all days filled despite 3 first-round failures
  });

  it('does not retry endlessly when AI is fully down', async () => {
    let calls = 0;
    await draftWeek({
      favourites: [], cuisines: ['indian', 'italian'], recentNames: [],
      pinned: new Map(), vegetarianNights: 0, rng: () => 0,
      generate: async () => { calls++; return null; },
    });
    // 7 AI slots, one round only (a fully-failed round stops further rounds).
    expect(calls).toBe(7);
  });

  it('rejects an over-cap cuisine in the first round and retries the slot', async () => {
    // 8 default cuisines (none configured) → cap of ceil(7/8) = 1 per cuisine.
    // The generator ignores the requested cuisine and always answers Mexican, so
    // every slot after the first is over cap and must be retried.
    const asked: string[] = [];
    let call = 0;
    await draftWeek({
      favourites: [], cuisines: [], recentNames: [],
      pinned: new Map(), vegetarianNights: 0, rng: () => 0,
      generate: async (req) => {
        asked.push(req.cuisine);
        return aiRecipe(`Mexican dish ${++call}`, 'mexican');
      },
    });
    // 7 slots in round 0; 6 of them are over cap and come back for round 1.
    expect(asked).toHaveLength(13);
  });

  it('relaxes the cap in the final round rather than leaving nights empty', async () => {
    let call = 0;
    const days = await draftWeek({
      favourites: [], cuisines: [], recentNames: [],
      pinned: new Map(), vegetarianNights: 0, rng: () => 0,
      generate: async () => aiRecipe(`Mexican dish ${++call}`, 'mexican'),
    });
    // A monotonous week beats an empty one: all 7 nights are filled.
    expect(days).toHaveLength(7);
    expect(days.every((d) => d.recipe.cuisine === 'mexican')).toBe(true);
  });

  it('keeps a cooperative generator inside the cap', async () => {
    let call = 0;
    const days = await draftWeek({
      favourites: [], cuisines: [], recentNames: [],
      pinned: new Map(), vegetarianNights: 0, rng: () => 0,
      generate: async (req) => aiRecipe(`Dish ${++call}`, req.cuisine),
    });
    expect(days).toHaveLength(7);
    const perCuisine = new Map<string, number>();
    for (const d of days) {
      const k = d.recipe.cuisine.toLowerCase();
      perCuisine.set(k, (perCuisine.get(k) ?? 0) + 1);
    }
    // Eight default cuisines over seven nights → every night a different one.
    expect([...perCuisine.values()].every((n) => n <= 1)).toBe(true);
  });

  it('counts pinned dinners toward the cap', async () => {
    const pinnedDinner = {
      day: 1, source: 'ai' as const, recipeId: 'r1', recipe: aiRecipe('Pinned tacos', 'mexican'),
    };
    const asked: string[] = [];
    await draftWeek({
      favourites: [], cuisines: [], recentNames: [],
      pinned: new Map([[1, pinnedDinner]]), vegetarianNights: 0, rng: () => 0,
      generate: async (req) => {
        asked.push(req.cuisine);
        return aiRecipe(`Mexican dish ${asked.length}`, 'mexican');
      },
    });
    // The pin already uses Mexican's single slot, so every one of the 6 AI slots
    // is over cap in round 0 and retried: 6 + 6 = 12 calls.
    expect(asked).toHaveLength(12);
  });

  it('generates AI dinners concurrently, not one-at-a-time', async () => {
    let active = 0;
    let maxActive = 0;
    const slow = async (req: { cuisine: string }) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return aiRecipe(`AI ${req.cuisine} ${Math.random()}`, req.cuisine);
    };
    await draftWeek({
      favourites: [], cuisines: ['indian', 'italian'], recentNames: [],
      pinned: new Map(), vegetarianNights: 0, rng: () => 0, generate: slow,
    });
    // All 7 days need AI (no favourites); concurrent generation means >1 in flight at once.
    expect(maxActive).toBeGreaterThan(1);
  });
});

describe('draftWeek equipment biasing', () => {
  it('prefers a favourite that uses standout gear the household has', async () => {
    const favourites = [favEq('Plain pasta', 'italian', []), favEq('Steam salmon', 'italian', ['steam'])];
    const days = await draftWeek({
      favourites, cuisines: ['italian'], recentNames: [],
      pinned: new Map(), vegetarianNights: 0, rng: () => 0, equipment: ['steam'],
      generate: async () => null,
    });
    // day 0 is a favourite slot (day % 2 === 0); the steam dish should win it.
    expect(days.find((d) => d.day === 0)?.recipe.name).toBe('Steam salmon');
  });

  it('passes the day benefit to the AI generator (speed weeknight, quality weekend)', async () => {
    // All 7 days are AI (no favourites). Capture the benefit keyed by the slot's day.
    const byDay: Record<number, string> = {};
    await draftWeek({
      favourites: [], cuisines: ['italian'], recentNames: [],
      pinned: new Map(), vegetarianNights: 0, rng: () => 0, equipment: ['steam', 'air-fry'],
      generate: async (req) => { byDay[req.day] = req.preferBenefit; return null; },
    });
    expect(byDay[0]).toBe('speed');   // Mon
    expect(byDay[3]).toBe('speed');   // Thu
    expect(byDay[4]).toBe('quality'); // Fri
    expect(byDay[6]).toBe('quality'); // Sun
  });

  it('method-spread penalty steers a favourite away from repeating the previous night’s standout gear', async () => {
    // Pin a steam dish on day 1 so the favourite slot on day 2 sees prevStandout=['steam'].
    // Favourites are ordered Baseline(idx0) BEFORE Steam(idx2) deliberately:
    //   day 0 (fav slot, no prev): a throwaway steam dish wins the +2 bonus and is consumed.
    //   day 2 (fav slot, prev=steam, weeknight): fresh = Baseline(idx0), Steam(idx2).
    //     WITHOUT the penalty Steam scores +2 and wins outright.
    //     WITH the penalty Steam scores +2 - 2 = 0, tying Baseline=0 → Baseline wins on
    //     lower insertion order. So Baseline landing on day 2 can ONLY be the penalty firing.
    const favourites = [
      favEq('Baseline pasta', 'italian', []),        // idx 0
      favEq('Throwaway steam', 'italian', ['steam']), // idx 1 — consumed by day 0
      favEq('Steam salmon', 'italian', ['steam']),    // idx 2 — the tempting repeat on day 2
    ];
    const pinnedSteam = {
      day: 1, source: 'favourite' as const, recipeId: 'pin-steam',
      recipe: favEq('Pinned steam bake', 'italian', ['steam']),
    };
    const days = await draftWeek({
      favourites, cuisines: ['italian'], recentNames: [],
      pinned: new Map([[1, pinnedSteam]]), vegetarianNights: 0, rng: () => 0,
      equipment: ['steam'], generate: async () => null,
    });
    // Sanity: day 0 took a steam favourite (no prev penalty), day 1 stays the pinned steam dish.
    expect(days.find((d) => d.day === 0)?.recipe.name).toBe('Throwaway steam');
    expect(days.find((d) => d.day === 1)?.recipe.name).toBe('Pinned steam bake');
    // The payoff: day 2 avoids a third steam night in a row, choosing the baseline dish.
    expect(days.find((d) => d.day === 2)?.recipe.name).toBe('Baseline pasta');
  });
});

describe('draftWeek slot events', () => {
  const collect = () => {
    const events: DraftEvent[] = [];
    return { events, onEvent: (e: DraftEvent) => events.push(e) };
  };

  it('reports a duplicate name collision', async () => {
    const { events, onEvent } = collect();
    await draftWeek({
      favourites: [], cuisines: ['italian'], recentNames: [],
      pinned: new Map(), vegetarianNights: 0, rng: () => 0, onEvent,
      generate: async () => aiRecipe('Same dish', 'italian'),
    });
    const dupes = events.filter((e) => e.type === 'ai-collision' && e.reason === 'duplicate-name');
    expect(dupes.length).toBeGreaterThan(0);
  });

  it('reports a cuisine-cap collision', async () => {
    const { events, onEvent } = collect();
    let n = 0;
    await draftWeek({
      favourites: [], cuisines: [], recentNames: [],
      pinned: new Map(), vegetarianNights: 0, rng: () => 0, onEvent,
      generate: async () => aiRecipe(`Mexican dish ${++n}`, 'mexican'),
    });
    const capped = events.filter((e) => e.type === 'ai-collision' && e.reason === 'cuisine-cap');
    expect(capped).toHaveLength(6); // 8 default cuisines → cap 1; 6 of 7 slots over cap
  });

  it('reports an empty AI result', async () => {
    const { events, onEvent } = collect();
    await draftWeek({
      favourites: [], cuisines: ['italian'], recentNames: [],
      pinned: new Map(), vegetarianNights: 0, rng: () => 0, onEvent,
      generate: async () => null,
    });
    expect(events.filter((e) => e.type === 'ai-empty')).toHaveLength(7);
  });

  it('reports a favourite used to backfill a failed AI slot', async () => {
    const { events, onEvent } = collect();
    // The favourite's cuisine deliberately does NOT match the configured one, so
    // phase 1's cuisine-matched pick cannot consume it and it is still on the
    // shelf for phase 3's cuisine-blind fallback. A matching favourite would be
    // placed in phase 1 and never reach the backfill path at all.
    await draftWeek({
      favourites: [fav('Thai green curry', 'thai')], cuisines: ['italian'], recentNames: [],
      pinned: new Map(), vegetarianNights: 0, rng: () => 0, onEvent,
      generate: async () => null,
    });
    const backfills = events.filter((e) => e.type === 'fallback-favourite');
    expect(backfills).toHaveLength(1);
    expect(backfills[0]).toMatchObject({ type: 'fallback-favourite', name: 'Thai green curry' });
    // One favourite covers one night; the other six have nothing left.
    expect(events.filter((e) => e.type === 'gap')).toHaveLength(6);
  });

  it('reports a night nothing could fill', async () => {
    const { events, onEvent } = collect();
    await draftWeek({
      favourites: [], cuisines: ['italian'], recentNames: [],
      pinned: new Map(), vegetarianNights: 0, rng: () => 0, onEvent,
      generate: async () => null,
    });
    expect(events.filter((e) => e.type === 'gap')).toHaveLength(7);
  });

  it('works without a callback', async () => {
    const days = await draftWeek({
      favourites: [], cuisines: ['italian'], recentNames: [],
      pinned: new Map(), vegetarianNights: 0, rng: () => 0,
      generate: async (req) => aiRecipe(`AI ${req.day}`, req.cuisine),
    });
    expect(days).toHaveLength(7);
  });
});
