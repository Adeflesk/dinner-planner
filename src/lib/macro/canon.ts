// Curated ingredient identity + buyable-unit conversion for shopping lists.
// Pure and deterministic, like the rest of src/lib/macro — no I/O.
// Fallback contract: anything not in these tables passes through unchanged,
// preserving the original "incompatible units stay separate" behaviour.

const SYNONYMS: Record<string, string> = {
  scallion: 'green onion',
  'spring onion': 'green onion',
  capsicum: 'bell pepper',
  courgette: 'zucchini',
  aubergine: 'eggplant',
  coriander: 'cilantro',
  'fresh coriander': 'cilantro',
  'garbanzo bean': 'chickpea',
};

// Whole items bought by count: average weight of one, and the unit you buy.
const BUYABLE: Record<string, { unit: 'pcs' | 'clove'; grams: number }> = {
  onion: { unit: 'pcs', grams: 150 },
  'bell pepper': { unit: 'pcs', grams: 120 },
  tomato: { unit: 'pcs', grams: 120 },
  lemon: { unit: 'pcs', grams: 100 },
  lime: { unit: 'pcs', grams: 70 },
  carrot: { unit: 'pcs', grams: 60 },
  zucchini: { unit: 'pcs', grams: 200 },
  potato: { unit: 'pcs', grams: 170 },
  cucumber: { unit: 'pcs', grams: 300 },
  avocado: { unit: 'pcs', grams: 170 },
  apple: { unit: 'pcs', grams: 180 },
  egg: { unit: 'pcs', grams: 55 },
  garlic: { unit: 'clove', grams: 3 },
};

// Products where 1 ml ≈ 1 g; mixed ml/g lines unify to g.
const WATERLIKE = new Set(['sour cream', 'yogurt', 'milk', 'cream']);

/** Trim, lowercase, resolve synonyms. Unknown names pass through. */
export function canonicalName(name: string): string {
  const n = name.trim().toLowerCase();
  return SYNONYMS[n] ?? n;
}

/**
 * Convert a canonical-named, canon-unit item toward the unit you actually buy.
 * g/kg of known produce → pcs (garlic → clove); ml/l of waterlike → g.
 * Everything else is returned unchanged. Never throws.
 */
export function toBuyable(item: { name: string; quantity: number; unit: string }) {
  const buy = BUYABLE[item.name];
  if (buy && (item.unit === 'g' || item.unit === 'kg')) {
    const grams = item.unit === 'kg' ? item.quantity * 1000 : item.quantity;
    return { name: item.name, quantity: grams / buy.grams, unit: buy.unit };
  }
  if (WATERLIKE.has(item.name) && (item.unit === 'ml' || item.unit === 'l')) {
    const ml = item.unit === 'l' ? item.quantity * 1000 : item.quantity;
    return { name: item.name, quantity: ml, unit: 'g' };
  }
  return item;
}
