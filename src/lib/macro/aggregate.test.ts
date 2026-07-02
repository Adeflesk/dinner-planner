import { describe, expect, it } from 'vitest';
import { aggregateIngredients, staplesUsed } from './aggregate';
import type { Ingredient } from './types';

const ing = (name: string, quantity: number, unit: string, section: Ingredient['section'] = 'other'): Ingredient =>
  ({ name, quantity, unit, section });

describe('aggregateIngredients', () => {
  it('merges same ingredient+unit across dinners, scaled', () => {
    const items = aggregateIngredients(
      [
        { ingredients: [ing('Onion', 2, 'pcs', 'produce')], scale: 1 },
        { ingredients: [ing('onion', 1, 'pcs', 'produce')], scale: 2 },
      ],
      [],
    );
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(4); // 2*1 + 1*2
  });
  it('keeps incompatible units as separate line items', () => {
    const items = aggregateIngredients(
      [{ ingredients: [ing('spinach', 1, 'bunch', 'produce'), ing('spinach', 200, 'g', 'produce')], scale: 1 }],
      [],
    );
    expect(items).toHaveLength(2);
  });
  it('canonicalizes unit synonyms so tbsp and tablespoon merge', () => {
    const items = aggregateIngredients(
      [
        { ingredients: [ing('olive oil', 2, 'tbsp', 'pantry')], scale: 1 },
        { ingredients: [ing('olive oil', 1, 'tablespoon', 'pantry')], scale: 1 },
        { ingredients: [ing('onion', 2, 'pieces', 'produce')], scale: 1 },
        { ingredients: [ing('onion', 1, 'pcs', 'produce')], scale: 1 },
      ],
      [],
    );
    const oil = items.find((i) => i.name === 'olive oil')!;
    const onion = items.find((i) => i.name === 'onion')!;
    expect(oil.quantity).toBe(3);
    expect(oil.unit).toBe('tbsp');
    expect(onion.quantity).toBe(3);
    expect(onion.unit).toBe('pcs');
  });
  it('filters pantry staples case-insensitively', () => {
    const items = aggregateIngredients(
      [{ ingredients: [ing('Olive Oil', 2, 'tbsp', 'pantry'), ing('chicken', 500, 'g', 'meat_fish')], scale: 1 }],
      ['olive oil'],
    );
    expect(items.map((i) => i.name)).toEqual(['chicken']);
  });
  it('rounds countable units (pcs, can, clove, slice) up to whole numbers', () => {
    const items = aggregateIngredients(
      [{
        ingredients: [
          ing('egg', 1, 'pcs', 'dairy'),
          ing('black bean', 3, 'can', 'pantry'),
          ing('garlic', 5, 'clove', 'produce'),
          ing('flour', 300, 'g', 'pantry'),
        ],
        scale: 0.75,
      }],
      [],
    );
    const byName = Object.fromEntries(items.map((i) => [i.name, i.quantity]));
    expect(byName['egg']).toBe(1);        // 0.75 → 1 (can't buy 0.75 of an egg)
    expect(byName['black bean']).toBe(3); // 2.25 → 3 cans
    expect(byName['garlic']).toBe(4);     // 3.75 → 4 cloves
    expect(byName['flour']).toBe(225);    // weights stay exact
  });
  it('rounds countable units up after merging across dinners, not per dinner', () => {
    // 0.6 + 0.6 = 1.2 → 2 pcs; per-dinner ceiling would give 1 + 1 = 2 as well,
    // so use 0.3 + 0.3 = 0.6 → 1 (per-dinner ceiling would wrongly give 2).
    const items = aggregateIngredients(
      [
        { ingredients: [ing('lemon', 0.3, 'pcs', 'produce')], scale: 1 },
        { ingredients: [ing('lemon', 0.3, 'pcs', 'produce')], scale: 1 },
      ],
      [],
    );
    expect(items[0].quantity).toBe(1);
  });
  it('sorts by store section order then name', () => {
    const items = aggregateIngredients(
      [{ ingredients: [ing('rice', 200, 'g', 'pantry'), ing('apple', 4, 'pcs', 'produce'), ing('beef', 400, 'g', 'meat_fish')], scale: 1 }],
      [],
    );
    expect(items.map((i) => i.section)).toEqual(['produce', 'meat_fish', 'pantry']);
  });
});

describe('staplesUsed', () => {
  it('returns only the staples this week needs, with quantities', () => {
    const used = staplesUsed(
      [
        { ingredients: [ing('olive oil', 2, 'tbsp', 'pantry'), ing('chicken', 500, 'g', 'meat_fish')], scale: 1.5 },
        { ingredients: [ing('Olive Oil', 1, 'tbsp', 'pantry')], scale: 1 },
      ],
      ['olive oil', 'salt'],
    );
    expect(used).toHaveLength(1);
    expect(used[0].name.toLowerCase()).toBe('olive oil');
    expect(used[0].quantity).toBe(4); // 2*1.5 + 1
  });
});
