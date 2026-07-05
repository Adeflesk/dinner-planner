import { describe, expect, it } from 'vitest';
import { canonicalName, toBuyable } from './canon';

describe('canonicalName', () => {
  it('resolves synonyms case-insensitively', () => {
    expect(canonicalName('Scallion')).toBe('green onion');
    expect(canonicalName('spring onion')).toBe('green onion');
    expect(canonicalName('Capsicum')).toBe('bell pepper');
    expect(canonicalName('fresh coriander')).toBe('cilantro');
  });
  it('passes unknown names through, lowercased and trimmed', () => {
    expect(canonicalName('  Basmati Rice ')).toBe('basmati rice');
  });
});

describe('toBuyable', () => {
  it('converts grams of known produce to pieces', () => {
    expect(toBuyable({ name: 'onion', quantity: 337.5, unit: 'g' }))
      .toEqual({ name: 'onion', quantity: 2.25, unit: 'pcs' });
  });
  it('converts kilograms of known produce to pieces', () => {
    expect(toBuyable({ name: 'potato', quantity: 1.7, unit: 'kg' }))
      .toEqual({ name: 'potato', quantity: 10, unit: 'pcs' });
  });
  it('converts grams of garlic to cloves, not pieces', () => {
    expect(toBuyable({ name: 'garlic', quantity: 11.25, unit: 'g' }))
      .toEqual({ name: 'garlic', quantity: 3.75, unit: 'clove' });
  });
  it('unifies waterlike ml (and l) to g', () => {
    expect(toBuyable({ name: 'sour cream', quantity: 75, unit: 'ml' }))
      .toEqual({ name: 'sour cream', quantity: 75, unit: 'g' });
    expect(toBuyable({ name: 'milk', quantity: 0.5, unit: 'l' }))
      .toEqual({ name: 'milk', quantity: 500, unit: 'g' });
  });
  it('leaves already-buyable and unknown items unchanged', () => {
    expect(toBuyable({ name: 'onion', quantity: 3, unit: 'pcs' }))
      .toEqual({ name: 'onion', quantity: 3, unit: 'pcs' });
    expect(toBuyable({ name: 'chicken breast', quantity: 500, unit: 'g' }))
      .toEqual({ name: 'chicken breast', quantity: 500, unit: 'g' });
    expect(toBuyable({ name: 'olive oil', quantity: 2, unit: 'tbsp' }))
      .toEqual({ name: 'olive oil', quantity: 2, unit: 'tbsp' });
  });
});
