# Two-Week Window — Design Spec

**Date:** 2026-07-11
**Status:** Approved by user (brainstorming session)
**Extends:** `2026-06-10-dinner-planner-design.md` (Plan and Shopping screens)

## Problem

The app is hard-locked to the current week: `currentWeekStart()` is called
directly in the Plan page, Shopping page, and every server action. When the
week rolls over on Monday, the built shopping list and planned week vanish
from view, and there is no way to plan the coming week ahead of the weekend.
This has caused two real "the app is broken" moments; it is the top backlog
item.

## Decision

A **two-week window**: the user can view and act on exactly two weeks — the
current week and the next one. The selected week travels in the URL
(`?week=next`; absent = current week). No past weeks, no arbitrary
navigation, no cookie state.

## Non-Goals

- Browsing past weeks (read-only history or otherwise). Old `weekPlans` rows
  remain in the database, unreachable from the UI.
- Planning more than one week ahead.
- Any schema change, service-signature change, or macro/planner-layer change.
  Services already take `weekStart` everywhere; the data model is already
  week-keyed.
- Client-side JS. The toggle is two links; state lives in the URL.

## Week Resolution (pure helpers)

In `src/lib/services/dates.ts`:

- `nextWeekStart(now?: Date): string` — the Monday after
  `currentWeekStart(now)`, same `YYYY-MM-DD` UTC convention.
- `resolveWeekStart(param: string | undefined, now?: Date): string` — maps
  the raw `?week=` value to one of exactly two legal outputs:
  - `'next'` → `nextWeekStart(now)`
  - anything else (`undefined`, garbage, a hand-typed date) → `currentWeekStart(now)`

**Trust boundary:** every server action re-resolves the week from the raw
param it received (`resolveWeekStart(String(formData.get('week') ?? ''))`).
The client can only ever select between the two legal Mondays; a crafted
request cannot create week rows at arbitrary dates.

## UI

### Week toggle (both pages)

A two-tab switcher in the existing eyebrow style, placed with the page
heading: **This week · Next week**. Plain links — `/` and `/?week=next` on
the Plan page, `/shopping` and `/shopping?week=next` on Shopping. The active
tab is visually marked (dijon underline, matching the nav's active
treatment). The `h1`/eyebrow continues to show the actual week dates, so the
acting week is always explicit.

### Plan page

- **Current week:** unchanged — Tonight hero, macro threads, week rail.
- **Next week:** macro threads + week rail only. **No hero** (nothing is
  "tonight" in a future week); the rail carries no `today` highlight.
- Plan / re-plan, swap, and pin all work identically on next week. Every
  action form gains a hidden `week` input carrying the raw param value.
- The post-plan banner links to the same week's list:
  `/shopping?week=next` when next week was planned.
- The `planned`/`degraded` redirect preserves the week param.

### Shopping page

- Same toggle. The staples check, build, rebuild, tick, add, and remove all
  operate on the viewed week (services are already week-scoped; only the
  actions' hard-coded `currentWeekStart()` calls change).
- Monday rollover heals itself: a list built for next week on Sunday **is**
  the current week's list on Monday, no action needed.

## Server Actions

All actions that currently call `currentWeekStart()` instead resolve the
week from a `week` form field:

- `planMyWeek`, `swapDayAction`, `togglePinAction` (plan)
- `buildListAction` (shopping; `toggleItemAction`/`addItemAction`/
  `removeItemAction` are list-id-scoped and need no week)

Redirects out of actions (`/?planned=1` etc.) append `&week=next` when the
acted-on week is the next week, so the user stays where they were.

## Error Handling

- Invalid `?week=` values are not an error — they resolve to the current
  week (the helper's fallback). No 404s, no validation messages.
- An unplanned next week shows the same empty states the current week does
  ("Plan my week", "No dinners planned yet — plan your week first").

## Testing

- **Unit:** `nextWeekStart` (mid-year, year boundary, Sunday/Monday edges);
  `resolveWeekStart` (`undefined` → current, `'next'` → next, garbage/dates →
  current).
- **Integration:** plan this week and next week side by side — two
  `weekPlans` rows, dinners independent; build both lists; re-planning next
  week does not disturb this week's list.
- **UI layer:** verified by typecheck + build per repo convention.
