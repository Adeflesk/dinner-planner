# Ingredient Canon — Design Spec

**Date:** 2026-07-05
**Status:** Approved by user (brainstorming session)
**Extends:** `2026-06-10-dinner-planner-design.md` (shopping-list aggregation)

## Problem

AI recipes name and measure the same ingredient inconsistently, so the
shopping list splits what is one purchase into several lines. Observed on a
real generated week: `3 pcs onion` + `337.5 g onion`, `12 clove garlic` +
`11.25 g garlic`, `0.75 pcs bell pepper` + `262.5 g bell pepper`, and
`1.5 pcs scallion` + `37.5 g green onion` (the same vegetable split by
synonym *and* unit).

## Decision

Merge to **buyable units** using a small curated, deterministic canon —
approximate conversions are acceptable on a shopping list (you buy 3 onions,
not 337.5 g). Prevention (prompt) and cure (aggregation) both ship; the cure
also fixes existing stored recipes.

## Non-Goals

- Merging genuinely different products that look similar: basmati / brown /
  white rice stay separate; `tofu` vs `firm tofu` stays split.
- A household-editable canon UI. The canon is a code table.
- Any schema, service, or UI change. This is macro-layer + prompt text only.
- An `≈` marker in the display. Counted-produce quantities are recorded here
  as inherently approximate; the display stays clean.

## The Canon (`src/lib/macro/canon.ts`)

A new pure module — deterministic, dependency-free, no I/O — holding three
curated tables and two functions.

### Tables

- **`SYNONYMS`** — alias → canonical name (compared case-insensitively):
  `scallion → green onion`, `spring onion → green onion`,
  `capsicum → bell pepper`, `courgette → zucchini`, `aubergine → eggplant`,
  `coriander → cilantro`, `fresh coriander → cilantro`,
  `garbanzo bean → chickpea`.
- **`PER_PIECE_G`** — average weight per piece for whole items bought by
  count (canonical names): onion 150, bell pepper 120, tomato 120,
  lemon 100, lime 70, carrot 60, zucchini 200, potato 170, cucumber 300,
  avocado 170, apple 180, egg 55. Special case **garlic: 3 g per clove**,
  target unit `clove` (not `pcs`).
- **`WATERLIKE`** — products where `1 ml ≈ 1 g`: sour cream, yogurt, milk,
  cream. Mixed `ml`/`g` lines unify to `g`.

### Functions

- `canonicalName(name: string): string` — trim/lowercase, apply `SYNONYMS`;
  unknown names pass through unchanged (lowercased).
- `toBuyable(item: { name; quantity; unit }): { name; quantity; unit }` —
  for a canonical name in `PER_PIECE_G` with unit `g`/`kg`, convert to the
  buyable unit (`pcs`, or `clove` for garlic) by dividing by the per-piece
  weight; for a `WATERLIKE` name with unit `ml`/`l`, convert to `g`.
  Anything else returns unchanged. Never throws.

## Aggregation Integration (`src/lib/macro/aggregate.ts`)

Inside `merge()`, each ingredient is passed through `canonicalName` +
`toBuyable` **before** the staple/exclusion check and before the merge key
is built. Consequences, all intentional:

1. Unit-split duplicates collapse: `3 pcs onion` + `337.5 g onion` →
   `3 + 2.25 pcs` → existing count-unit ceiling → **`6 pcs onion`**.
2. Synonym-split duplicates collapse: scallion and green onion merge.
3. **The staple filter becomes synonym-aware**: a pantry staple named
   "green onion" now also filters "scallion" lines (staple names are
   canonicalized on the same path).
4. The fallback for anything the canon does not know is exactly today's
   behavior — the original spec's "incompatible units stay separate" rule.

`staplesUsed` shares `merge()`, so the staples-check screen benefits
identically.

## Prompt Hardening (`src/lib/ai/recipes.ts`)

Two additions to the existing `UNIT_GUIDANCE` constant (already shared by
the weekly generator and the macro estimator):

- Prefer `pcs` for whole produce (onion, pepper, tomato, lemon, etc.) rather
  than grams.
- Use one canonical name per ingredient (e.g. "green onion", not
  "scallion"; "cilantro", not "fresh coriander").

Prevention only — the aggregation cure above is what fixes stored recipes.

## Testing

Unit tests only (`canon.test.ts` + extended `aggregate.test.ts`):

- synonym canonicalization (case-insensitive; unknown passes through);
- `toBuyable` conversions: g→pcs, kg→pcs, garlic g→clove, waterlike ml→g,
  unknown/already-buyable unchanged;
- end-to-end merge: pcs+g onion → single ceiled `pcs` line; clove+g garlic;
  ml+g sour cream; scallion+green onion; rice varieties remain separate;
- staple filtering catches synonym lines;
- existing aggregate tests remain green (fallback unchanged).
