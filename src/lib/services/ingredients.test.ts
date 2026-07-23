import { describe, expect, it } from 'vitest';
import { parseIngredientLines, formatIngredientLines } from './ingredients';

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

describe('formatIngredientLines', () => {
  it('renders one "qty unit name" line per ingredient', () => {
    expect(formatIngredientLines([
      { name: 'chicken breast', quantity: 500, unit: 'g', section: 'meat_fish' },
      { name: 'onion', quantity: 2, unit: 'pcs', section: 'produce' },
    ])).toBe('500 g chicken breast\n2 pcs onion');
  });

  it('round-trips through parseIngredientLines (name, quantity, unit preserved)', () => {
    const original = [
      { name: 'olive oil', quantity: 1.5, unit: 'tbsp', section: 'pantry' as const },
      { name: 'lemon', quantity: 1, unit: 'pcs', section: 'produce' as const },
    ];
    const reparsed = parseIngredientLines(formatIngredientLines(original));
    expect(reparsed.map(({ name, quantity, unit }) => ({ name, quantity, unit }))).toEqual(
      original.map(({ name, quantity, unit }) => ({ name, quantity, unit })),
    );
  });
});
