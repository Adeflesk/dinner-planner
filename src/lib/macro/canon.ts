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

// Dry staples measured either by weight or by the cup, depending on the recipe.
// Grams in one (US) cup, uncooked — without these, "300 g rice" and "1 cup rice"
// key separately and the list shows the same bag twice. Only ingredients with a
// stable packed weight belong here; anything chopped or leafy varies too much.
const CUP_GRAMS: Record<string, number> = {
  rice: 185,
  'white rice': 185,
  'long grain rice': 185,
  'basmati rice': 185,
  'jasmine rice': 185,
  'brown rice': 190,
  'arborio rice': 200,
  flour: 125,
  'plain flour': 125,
  'all-purpose flour': 125,
  'bread flour': 125,
  'wholemeal flour': 120,
  'whole wheat flour': 120,
  sugar: 200,
  'brown sugar': 220,
  oats: 90,
  'rolled oats': 90,
  lentils: 192,
  'red lentils': 192,
  quinoa: 170,
  couscous: 175,
  breadcrumbs: 110,
};

/** Trim, lowercase, resolve synonyms. Unknown names pass through. */
export function canonicalName(name: string): string {
  const n = name.trim().toLowerCase();
  return SYNONYMS[n] ?? n;
}

/**
 * Convert a canonical-named, canon-unit item toward the unit you actually buy.
 * g/kg of known produce → pcs (garlic → clove); ml/l of waterlike → g;
 * cups of dry staples → g.
 * Everything else is returned unchanged. Never throws.
 */
export function toBuyable(item: { name: string; quantity: number; unit: string }) {
  const perCup = CUP_GRAMS[item.name];
  if (perCup && item.unit === 'cup') {
    return { name: item.name, quantity: item.quantity * perCup, unit: 'g' };
  }
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
