# Planner Variety and Gap Reporting — Design Spec

**Date:** 2026-08-19
**Status:** Approved by user (brainstorming session)
**Roadmap item:** new — arises from the 2026-08-19 review of the recipe finder;
partially covers item 11 (Monitoring)

## Problem

Two complaints, reported together: the planner does not fill a full week, and
the dinners it does produce lean heavily Mexican. Reading the drafting path
end to end shows they are the same fault expressed twice.

`cuisineSequence` returns `Array(7).fill('any')` when the household has no
preferred cuisines configured (`src/lib/planner/draft.ts:26`), and
`settings.cuisines` defaults to `[]` (`src/lib/db/schema.ts:68`) with no seed.
Unless somebody has filled in the "Preferred cuisines" field on the Family
page, all seven AI prompts are byte-identical apart from `avoidNames`:

> Create one family dinner recipe (4 base servings) in any cuisine.

From there:

- A small model asked for "any cuisine" plus "family dinner" collapses to a
  narrow mode — tacos, fajitas, burrito bowls, enchiladas. That is the
  Mexican bias. Nothing anywhere in the drafter counts cuisines or pushes
  back on repetition.
- Those near-identical calls run **concurrently**
  (`src/lib/planner/draft.ts:139`) sharing one `avoidNames` snapshot, so no
  slot can see what its siblings just produced. Several come back with the
  same dish. Exact-name collisions are dropped
  (`src/lib/planner/draft.ts:146`), the retry round collides the same way,
  and the leftovers fall through to a favourites-only backfill that a small
  library cannot satisfy. Those days end up empty.

Three further faults make it worse, or make it invisible:

**The equipment gate discards good recipes.** `generateRecipe` rejects the
*entire* recipe if the model returns any capability string outside the
household's list (`src/lib/ai/recipes.ts:88`). The roadmap's operational
reminder notes that kitchen equipment is very likely still unticked on the
live Family page, which makes `req.equipment` empty — so a model that
answers `["oven"]` instead of the required empty array has a perfectly good
dinner binned, twice, and the slot returns `null`. This is a metadata slip
being treated as a cooking impossibility, and it is probably the single
largest source of empty days today.

**Gaps are invisible.** `draftWeek` filters nulls out of its result
(`src/lib/planner/draft.ts:172`) and `planWeek` reports only
`aiDegraded = aiRequested > 0 && aiSucceeded === 0`. A week with three of
seven days filled redirects to `?planned=1` and reads as a success.

**Nothing is logged.** `grep -rn "console\." src/lib` returns nothing. Both
`catch` blocks in `generateRecipe` are bare, and every validation failure is
a silent `continue`. There is currently no way to tell whether a missing
dinner was a timeout, a rate limit, an energy-check failure, or an equipment
mismatch.

## Decision

Six changes, in the order they matter:

1. Cuisine policy moves to its own module and never yields `'any'`.
2. `draftWeek` enforces a per-cuisine cap on AI results, relaxed in the
   final round.
3. The equipment gate strips invented tags instead of binning the recipe.
4. `planWeek` reports how many nights it actually filled, and the Plan page
   says so.
5. `generateRecipe` logs a reason for every rejected attempt.
6. `draftWeek` emits structured slot events through an injected callback.

## 1. Cuisine policy — `src/lib/planner/cuisines.ts`

A new module owns `DEFAULT_CUISINES` and a rewritten `cuisineSequence`,
moved out of `draft.ts`. The split keeps `draft.ts` responsible for
assembling a week rather than also owning cuisine policy, and gives the new
logic a test file of its own. `draft.ts` is 173 lines and this feature adds
to it; moving one concern out keeps it readable.

```ts
export const DEFAULT_CUISINES = [
  'Italian', 'Thai', 'Indian', 'Mexican',
  'Japanese', 'Greek', 'Middle Eastern', 'British',
] as const;

/** The list actually used: `configured` when non-empty, else the defaults. */
export function effectiveCuisines(configured: string[]): string[];

export function cuisineSequence(
  configured: string[],
  length: number,
  rng?: () => number,
): string[];
```

Eight entries, so a seven-day week draws seven distinct cuisines and Mexican
can appear at most once.

`effectiveCuisines` is exported separately because `draftWeek` needs the
size of the list actually in play to compute its cap (section 2), and must
not have to guess whether the defaults were substituted.

The new contract:

- **Source list** is `configured` when non-empty, otherwise
  `DEFAULT_CUISINES`. The Family page keeps full override control; the
  default only fills a vacuum.
- **Balanced dealing.** Shuffle the source, then repeat it until `length`
  slots are filled, so the count of any two cuisines differs by at most one.
  Three configured cuisines over seven days give 3/2/2, never 5/1/1. The old
  function sampled with replacement, which permitted exactly the lopsided
  draws being complained about.
- **No adjacent repeats** when the source has two or more entries, arranged
  greedily: at each slot take the cuisine with the most remaining uses that
  is not the previous day's.
- **Never returns `'any'`.** The string leaves the planner entirely.

Balancing subsumes the fixed "cap at two nights" this design first
considered, and degrades better: with a single configured cuisine all seven
days are that cuisine, which is correct, where a hard cap of two would be
unsatisfiable.

## 2. Per-cuisine cap on AI results — `draftWeek`

The generator is *asked* for cuisine X but self-reports whatever it likes in
`recipe.cuisine`, so the sequence's balance guarantees nothing on its own.
`draftWeek` therefore tracks placed dinners by normalised cuisine against:

```text
allowedPerCuisine = Math.ceil(7 / sourceCount)
```

which is the same balance `cuisineSequence` already promises — eight default
cuisines give 1, three configured give 3, one configured gives 7 (no cap).

**The cap only applies in round 0.** A result that would exceed it is
returned to `pending` exactly like a name collision. In the final round the
cap is dropped and any non-duplicate result is accepted.

That asymmetry is the point. A cap enforced on every round would reject
dinners the household has no replacement for and convert a variety problem
into more empty days — the opposite of the goal. A Mexican dinner beats an
empty Tuesday.

Favourites placed in phase 1 already match their slot's cuisine, but they
count toward the tally so AI slots see an accurate picture. Phase 3's
last-ditch `pickFavourite(..., null, ...)` ignores cuisine, as it does today;
filling the day wins.

## 3. Equipment gate softening — `src/lib/macro/equipment.ts`, `src/lib/ai/recipes.ts`

A new pure helper alongside the existing `lacksEquipment`, same style, no I/O:

```ts
export function knownCapabilities(equipment: string[]): string[];
```

It normalises and filters to members of `CAPABILITIES`, dropping anything the
vocabulary does not recognise.

`generateRecipe` strips before it screens:

```ts
const equipment = knownCapabilities(recipe.equipment);
if (!energyConsistent(recipe.perServing)) continue;
if (violatesAllergies(recipe.ingredients, req.allergies).length > 0) continue;
if (lacksEquipment(equipment, req.equipment).length > 0) continue;
return { ...recipe, equipment };
```

The distinction this draws:

- Model returns `["oven"]`, household has `[]` — `"oven"` is not in
  `CAPABILITIES`, so it is stripped and the recipe is accepted. This is the
  fix for the unticked-equipment state on the live site.
- Model returns `["sous-vide"]`, household lacks sous-vide — a real
  capability the kitchen genuinely does not have, so the recipe is still
  rejected. Appliance-aware screening keeps working as specified in
  `2026-06-25-appliance-aware-recipes-design.md`.

The recipe returned carries the stripped, normalised array, so what reaches
the `recipes` table is clean and `standoutTags` badging on the Plan page
becomes more reliable as a side effect. `estimateRecipe` gets the same
stripping, for consistency and to keep user-entered recipes as tidy.

## 4. Gap reporting — `planWeek`, `planMyWeek`, Plan page

`planWeek` returns:

```ts
{ aiDegraded: boolean; filled: number; gaps: number }
```

`filled` is `days.length` — pinned days included, since they occupy a night —
and `gaps` is `7 - filled`. `draftWeek` needs no signature change for this;
it already returns only real dinners.

`aiDegraded` keeps its current meaning and its current banner. The two are
independent: AI can be entirely down (degraded, no gaps) if favourites cover
the week, and AI can be up but repetitive (not degraded, several gaps).

`planMyWeek` appends `&gaps=N` when `N > 0`. When the param is present the
Plan page shows an amber notice in place of the green one, carrying the same
shopping-list link:

> Filled 5 of 7 nights — 2 couldn't be generated. Use the swap buttons on
> those days to fill them.

Replacing rather than stacking: a green "Week planned" above an amber "two
nights missing" is contradictory. The empty day cards already render a
"Nothing planned" state with a manual picker from the manual-pick-swap
feature, so the remedy the notice points at exists.

## 5. Failure logging — `src/lib/log.ts`, `generateRecipe`

A dependency-free structured logger:

```ts
export function logEvent(evt: string, fields?: Record<string, unknown>): void;
export function logWarn(evt: string, fields?: Record<string, unknown>): void;
```

Each writes one line of JSON — `console.log` and `console.warn` respectively
— so Vercel runtime logs stay greppable and a future log drain can parse them
without a format change.

**Which is used where:** every failure event, in both `generateRecipe` and
the `draftWeek` event forwarder, goes through `logWarn`. The single
`plan.summary` line goes through `logEvent`. So `console.warn` carries
exactly the things that went wrong, and a test can silence and assert on one
channel.

**No test-environment branch.** Tests that trigger failures spy on
`console.warn`, which both silences the output and lets them assert the
reason code. A logger with a test-only silent path is a logger whose output
is never verified.

`generateRecipe` logs a reason per rejected attempt:

| Event | Fields |
| --- | --- |
| `recipe.timeout` | `cuisine`, `attempt` |
| `recipe.ai_error` | `cuisine`, `attempt`, `message` |
| `recipe.energy_inconsistent` | `cuisine`, `attempt`, `kcal`, `computed` |
| `recipe.allergy_violation` | `cuisine`, `attempt`, `allergens` |
| `recipe.equipment_unavailable` | `cuisine`, `attempt`, `missing` |

plus one `recipe.failed` with `cuisine` and `attempts` when both attempts are
spent. Timeouts are distinguished from other throws by the abort signal's
error name, since a timeout and a schema error call for different responses.

## 6. Slot events — `draftWeek`

`draftWeek` must stay free of I/O, so it does not log. It accepts an optional
callback, the same injection idiom as its existing `generate` parameter:

```ts
type DraftEvent =
  | { type: 'ai-collision'; day: number; reason: 'duplicate-name' | 'cuisine-cap'; name: string }
  | { type: 'ai-empty'; day: number }
  | { type: 'fallback-favourite'; day: number; name: string }
  | { type: 'gap'; day: number };

onEvent?: (event: DraftEvent) => void;
```

The callback is optional, so every existing caller and test keeps working
unchanged, and tests can assert on events directly rather than stubbing
`console`.

`planWeek` passes a callback forwarding each event to `logWarn`, and emits
one `plan.summary` line:

```json
{"evt":"plan.summary","weekStart":"2026-08-17","requested":7,"succeeded":4,
 "filled":5,"gaps":2,"cuisines":{"italian":2,"thai":1,"mexican":1,"indian":1}}
```

That summary line is the one worth reading: a single grep says whether a short
week came from AI failures, cap rejections, or an exhausted favourites library.

## Testing

TDD throughout, per the repo cycle. The pure layers carry most of the weight.

**`src/lib/planner/cuisines.test.ts`** (new)

- Balance invariant: for any source size and length, `max - min <= 1`.
- No adjacent repeats when the source has two or more entries.
- Falls back to `DEFAULT_CUISINES` when `configured` is empty.
- Never emits `'any'`.
- Single configured cuisine fills every slot with it.
- Deterministic under a seeded rng; different seeds give different orders.

**`src/lib/planner/draft.test.ts`**

- Existing tests updated for the `cuisineSequence` import move.
- The cap is enforced in round 0: a generator that always returns Mexican
  gets its over-cap results rejected and retried.
- The cap is relaxed in the final round: the same generator still fills the
  week rather than leaving gaps.
- No slot ever requests `'any'`.
- `onEvent` fires with `cuisine-cap` and `duplicate-name` reasons, and with
  `gap` for a day nothing could fill.

**`src/lib/ai/recipes.test.ts`**

- An invented tag (`["oven"]`) is stripped and the recipe accepted, with the
  household equipment empty.
- A real capability the household lacks is still rejected — the existing
  equipment re-screen tests must keep passing.
- The returned recipe carries the stripped, normalised array.
- Each rejection reason logs its event (spying on `console.warn`).

**Integration (PGlite)**

- `planWeek` reports accurate `gaps` when the fake generator fails some
  slots, and `gaps: 0` on a full week.
- `aiDegraded` and `gaps` vary independently.

No component test for the banner; it is a one-line conditional in
`page.tsx` matching the two banners already beside it.

## Non-goals

Deferred to the roadmap rather than dropped:

- **`swapDay`'s cuisine choice.** Plain `'ai'` mode uses
  `ctx.config.cuisines[0] ?? 'any'` (`src/lib/services/planning.ts:176`) —
  always the first configured cuisine, so swapping away from a Mexican dinner
  can hand back another one. Should use the day's own cuisine from the
  rotation. Left out to keep this spec to the drafting path.
- **Near-duplicate name detection.** Dedupe is exact-name only, so "Chicken
  Tacos" and "Beef Tacos" both stand. The cuisine cap addresses most of the
  observed symptom; fuzzy matching risks false rejections and deserves its
  own pass.
- **Retry backoff.** `generateRecipe` retries immediately, so a rate limit on
  a seven-call burst likely hits again. The new logging will show whether
  this happens in practice before anything is built for it.

## Risks

- **`DEFAULT_CUISINES` is an opinion in code.** Eight cuisines chosen for
  spread, not for this household's taste. Mitigated by the Family page
  override, which continues to take precedence, and by the amber notice
  making a bad week visible.
- **The cap could mask a real preference.** A household that configures only
  Mexican and Italian gets `ceil(7/2) = 4` per cuisine, which is permissive
  enough not to fight them. The cap scales with the source list precisely so
  it never overrides an explicit choice.
- **Logging volume.** One summary line per plan plus one per failed slot —
  single digits per week for a household app, well inside Vercel's retention.
