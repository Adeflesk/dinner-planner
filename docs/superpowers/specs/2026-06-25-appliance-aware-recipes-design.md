# Appliance-Aware Recipes — Design Spec

**Date:** 2026-06-25
**Status:** Approved by user (brainstorming session)
**Extends:** `2026-06-10-dinner-planner-design.md`

## Problem

The dinner planner generates recipe method text and macros with no notion of
what equipment the kitchen has. Every recipe implicitly assumes a generic
stovetop and standard oven. A household with capable gear — e.g. a Miele combi
steam oven and a combi microwave — gets neither tailored cooking instructions
nor suggestions that play to that equipment's strengths.

## Goals

- Let the household record what cooking equipment it has, once, as part of its
  settings.
- Write recipe method steps for the household's actual appliances (steam-oven
  programs, combi modes, timings) rather than generic stovetop prose.
- Softly bias weekly suggestions toward recipes that exploit standout
  appliances, while spreading cooking methods for variety.
- Never plan a recipe whose method calls for equipment the household lacks.

## Non-Goals

- A per-model appliance catalogue (specific Miele model numbers and their exact
  named programs). Capability tags only.
- "Showcase" mode that maximises premium-gear usage every night.
- Per-person equipment or multiple kitchens — this is a single shared kitchen,
  consistent with the single-household design.
- Any change to the macro engine's arithmetic. Equipment is not arithmetic.

## Decisions Log

| Decision | Choice |
| --- | --- |
| Payoff | Both: tailored method text **and** equipment-aware suggestions |
| Appliance model | Capability tags from a fixed vocabulary (not free text, not a model catalogue) |
| Recipe schema | Structured `equipment[]` field on Recipe (not prose-only) |
| Biasing | Soft preference + cooking-method spread for variety (not showcase, not zero-bias) |
| Benefit-aware biasing | Each standout capability carries a `quality` or `speed` benefit; weeknights lean speed, weekends lean quality |
| Scope of equipment | Single shared kitchen, stored in household settings |

## Capability Vocabulary

A fixed, closed set of capability tags:

`steam · combi-steam · microwave · convection · grill/broil · induction-hob · air-fry · sous-vide`

Both the household's equipment and a recipe's `equipment[]` draw from this same
vocabulary, which makes the validation and biasing comparisons trivial set
operations.

### Standout vs baseline

The vocabulary splits into two groups. This distinction is load-bearing: only
standout tags drive biasing and badging, so that gear every kitchen has does not
trigger either.

- **Standout:** `steam`, `combi-steam`, `sous-vide`, `air-fry` — special gear
  worth exploiting and worth badging.
- **Baseline:** `convection`, `grill/broil`, `induction-hob`, `microwave` —
  assumed-ordinary; never biased toward, never badged. (A recipe with empty
  `equipment[]`, or only baseline tags, is treated as an everyday stovetop/oven
  meal.)

### Benefit mapping (quality vs speed)

Each **standout** capability carries a benefit, because the two premium
appliances have opposite superpowers and the planner should not flatten them:

| Capability | Benefit | Why |
| --- | --- | --- |
| `steam`, `combi-steam`, `sous-vide` | `quality` | Moisture control and gentle cooking — juicy roasts, bread, batch veg, reheating without drying. |
| `air-fry`, microwave-combi roasting | `speed` | Fast hands-off weeknight cooking — e.g. a jacket potato in ~12 min, speed-roast chicken. |

The planner uses this to **lean speed on weeknights (Mon–Thu) and quality on
weekends (Fri–Sun)** rather than treating all standout gear as one
undifferentiated "nice to use." The benefit map is a static lookup, not stored
per recipe.

### Tag semantics to pin down (UK/AU English)

- `grill/broil` means the **oven's overhead grill element**, not an outdoor
  barbecue. The household uses UK/AU English ("grill" = broiler); the prompt must
  not write barbecue steps for this tag.

### Example mapping for the user's kitchen

A Miele combi steam oven → `steam`, `combi-steam`, `convection`; a Miele combi
microwave → `microwave`, `convection`/`grill` as applicable; plus `induction-hob`
and a standard `convection` oven.

## Data Model Changes

### Household settings

Add `equipment`: a set of capability tags. Entered once via a checkbox picker on
the Family/Household screen, alongside preferred cuisines, pantry staples, and
dinner-share %.

### Recipe

Add `equipment[]`: the capability tags a recipe actually uses.

- **Optional**, defaults to **empty**.
- Empty means "basic stovetop / standard oven, no special gear" — so every
  existing favourite remains valid with **zero backfill**.

## How Each Goal Is Served

| Goal | Mechanism |
| --- | --- |
| Method written for this kitchen | The AI prompt gains the household's equipment tags plus the prompt requirements below; `generateObject` is instructed to write method steps using that gear and to populate the recipe's `equipment[]`. |
| Equipment-aware suggestions (soft bias) | Planning passes equipment as a *preference* and spreads cooking methods across the week — extending the existing "no two same-cuisine nights back-to-back" logic to also avoid method monotony (e.g. not four steam-oven nights in a row). |
| Never plan unavailable gear | A new in-code validation screen (below). |

## Prompt Requirements

Tagging gear is not enough; the method text has to actually exploit it. The
generation prompt must include these instructions so it produces real
appliance-tailored methods rather than generic prose with the gear's name bolted
on:

- **Steam-oven program language.** For `steam`/`combi-steam`, write Miele-style
  program steps including the **moisture/humidity setting**, e.g. "Combi Steam,
  160 °C, 60 % moisture" — moisture control *is* the feature.
- **Steam physics guardrail.** Pure `steam` caps at **100 °C**; only combi modes
  exceed it. The prompt forbids "steam at 200 °C" (which is really
  convection-plus-steam). A method that violates this should read as a combi
  step, not pure steam.
- **Single cavity / single oven.** A combi steam oven is **one cavity**. A recipe
  must not assume the steam oven runs two programs at once (e.g. protein and veg
  at different temps simultaneously). The method should sequence steps, or use the
  hob for a side, rather than assume a second oven.
- **`grill/broil` = oven overhead grill**, not a barbecue (UK/AU English).

## Validation of AI Output

Adds a third check to the existing in-code validation, alongside
energy-consistency and allergy re-screen:

1. **Energy consistency** (unchanged): kcal ≈ 4·P + 4·C + 9·F within ±15%.
2. **Allergy re-screen** (unchanged): ingredient names vs. allergy list.
3. **Equipment re-screen** (new): if a generated recipe's `equipment[]` contains
   any capability the household does not have → reject → silently regenerate
   (1 retry per slot), the same pattern as today.

The equipment re-screen is a pure predicate over
`(recipe.equipment, household.equipment)` — a subset test — and is unit-testable
with no I/O.

## Planner Changes

The weekly draft's variety logic, today expressed as cuisine spreading, is
extended to also spread cooking methods and to apply the benefit map:

- **Standout preference, never forced.** Recipes using a *standout* capability are
  ranked up; baseline-only recipes are not. Equipment is a tie-breaker steer, not
  a hard requirement.
- **Method spread.** The draft avoids back-to-back nights dominated by the same
  cooking method, mirroring the existing same-cuisine avoidance (e.g. not four
  steam-oven nights in a row).
- **Benefit by day.** Weeknights (Mon–Thu, days 0–3) lean toward `speed`-benefit
  recipes; weekends (Fri–Sun, days 4–6) lean toward `quality`-benefit recipes,
  using the benefit map. This is a soft ranking nudge, applied after allergy /
  dislike / diet-rule filtering and subordinate to macro fit.

This logic is pure and deterministic — it ranks and orders already-fetched
candidate recipes using static lookups (standout set, benefit map) — so it is
unit-testable like the cuisine spread it extends. It performs no I/O.

## UI Changes

- **Family/Household screen:** an equipment picker (checkboxes over the capability
  vocabulary), next to preferred cuisines / pantry staples / dinner-share %.
- **Day card & dinner detail:** a small badge when a dinner's `equipment[]`
  includes a **standout** tag (`steam`, `combi-steam`, `sous-vide`, `air-fry`) —
  e.g. "🫧 Steam oven". Baseline-only recipes get no badge, so the cue stays
  meaningful.
- **Recipes screen:** the existing "estimate macros with AI" helper also suggests
  `equipment[]` tags from the typed method/ingredients; the user can edit before
  saving. Manual recipes may leave `equipment[]` empty.

## Pure-Engine Impact

The macro engine (targets, portion solver, weekly tally, list aggregation) is
**untouched** — equipment never enters arithmetic. The only deterministic
additions are:

- the **equipment re-screen** predicate (pure, unit-tested), and
- the **method-spread** ranking/ordering in the planner (pure, unit-tested).

Both are dependency-free and do no I/O, consistent with the layering rules.

## Cost & Limits

Negligible. Equipment adds a few tokens to the same `generateObject` calls — no
new calls, no new model, no new dependency. The monthly cap (~$5) and
favourites-only fallback are unchanged. If AI is unavailable, the favourites-only
draft simply ignores equipment biasing and still works.

## Testing Strategy

- **Unit tests:**
  - the equipment re-screen predicate (recipe needs a capability the household
    lacks → reject; subset → pass; empty recipe equipment → always pass);
  - the standout/baseline split (baseline-only recipe → no preference, no badge;
    standout recipe → badged);
  - the method-spread ranking/ordering (preference applied; back-to-back
    same-method avoided; degrades gracefully when candidates are uniform);
  - the benefit-by-day nudge (weeknight slot favours `speed`, weekend slot favours
    `quality`; stays subordinate to macro fit and never overrides
    allergy/dislike/diet filtering).
- **Integration tests:** planning a week with a configured equipment set surfaces
  method-tailored recipes and never plans unavailable gear; the equipment picker
  persists to household settings.
- **AI mocked everywhere:** fixture recipes carry `equipment[]` values to exercise
  the re-screen and biasing; no live model calls in CI.
