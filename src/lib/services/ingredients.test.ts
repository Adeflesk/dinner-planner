import { describe, expect, it } from 'vitest';
import { parseIngredientLines } from './ingredients';

describe('parseIngredientLines', () => {
  it('parses "qty unit name" lines', () => {
    expect(parseIngredientLines('200 g chicken breast\n2 pcs onion')).toEqual([
      { name: 'chicken breast', quantity: 200, unit: 'g', section: 'other' },
      { name: 'onion', quantity: 2, unit: 'pcs', section: 'other' },
    ]);
  });
  it('defaults quantity 1 pcs for bare names and skips blank lines', () => {
    expect(parseIngredientLines('lemon\n\n')).toEqual([
      { name: 'lemon', quantity: 1, unit: 'pcs', section: 'other' },
    ]);
  });
});
