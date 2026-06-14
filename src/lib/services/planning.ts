import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '@/lib/db';
import {
  people, plannedDinners, recipes, settings, shoppingLists, weekPlans,
} from '@/lib/db/schema';
import { dinnerTargets } from '@/lib/macro/targets';
import { scale, solvePortions } from '@/lib/macro/portions';
import { weeklyTally, weeklyTargetFor } from '@/lib/macro/tally';
import { draftWeek, type DraftDinner, type DraftGenerateRequest } from '@/lib/planner/draft';
import { generateRecipe, aiGenerator, type Generator } from '@/lib/ai/recipes';
import type { MacroSet } from '@/lib/macro/types';

export async function getSettings(db: Db) {
  const [row] = await db.select().from(settings).where(eq(settings.id, 1));
  if (row) return row;
  const [created] = await db.insert(settings).values({ id: 1 }).returning();
  return created;
}

export async function getOrCreateWeekPlan(db: Db, weekStart: string) {
  const [existing] = await db.select().from(weekPlans).where(eq(weekPlans.weekStart, weekStart));
  if (existing) return existing;
  const [created] = await db.insert(weekPlans).values({ weekStart }).returning();
  return created;
}

async function loadContext(db: Db) {
  const household = await db.select().from(people);
  const config = await getSettings(db);
  const favourites = await db.select().from(recipes).where(eq(recipes.source, 'family'));
  const allergies = [...new Set(household.flatMap((p) => p.allergies))];
  const dislikes = [...new Set(household.flatMap((p) => p.dislikes))];
  const targets = household.map((p) => ({
    personId: p.id,
    target: dinnerTargets(p, config.dinnerShare),
  }));
  const avgTarget: MacroSet = targets.length
    ? {
        kcal: targets.reduce((s, t) => s + t.target.kcal, 0) / targets.length,
        protein: targets.reduce((s, t) => s + t.target.protein, 0) / targets.length,
        carbs: targets.reduce((s, t) => s + t.target.carbs, 0) / targets.length,
        fat: targets.reduce((s, t) => s + t.target.fat, 0) / targets.length,
      }
    : { kcal: 650, protein: 35, carbs: 65, fat: 22 };
  return { household, config, favourites, allergies, dislikes, targets, avgTarget };
}

async function persistDinner(
  db: Db,
  weekPlanId: string,
  dinner: DraftDinner,
  targets: { personId: string; target: MacroSet }[],
) {
  let recipeId = dinner.recipeId;
  if (!recipeId) {
    const [saved] = await db.insert(recipes).values({ ...dinner.recipe, source: 'ai' }).returning();
    recipeId = saved.id;
  }
  const { portions, householdServings } = solvePortions(dinner.recipe.perServing, targets);
  await db.insert(plannedDinners).values({
    weekPlanId, day: dinner.day, recipeId, householdServings, portions, pinned: false,
  });
}

/** Draft and persist a full week. Returns true if AI was unavailable (favourites-only fallback). */
export async function planWeek(
  db: Db,
  weekStart: string,
  gen: Generator = aiGenerator,
): Promise<{ aiDegraded: boolean }> {
  const ctx = await loadContext(db);
  const plan = await getOrCreateWeekPlan(db, weekStart);

  const existing = await db.select().from(plannedDinners).where(eq(plannedDinners.weekPlanId, plan.id));
  const pinnedRows = existing.filter((d) => d.pinned);
  const pinned = new Map<number, DraftDinner>();
  for (const row of pinnedRows) {
    const [r] = await db.select().from(recipes).where(eq(recipes.id, row.recipeId));
    pinned.set(row.day, { day: row.day, source: r.source === 'ai' ? 'ai' : 'favourite', recipeId: r.id, recipe: r });
  }
  await db.delete(plannedDinners).where(
    and(eq(plannedDinners.weekPlanId, plan.id), eq(plannedDinners.pinned, false)),
  );

  // Only AI-generated recipes count as "recent"; family favourites are permanently in rotation.
  const recent = await db.select().from(recipes)
    .where(eq(recipes.source, 'ai'))
    .orderBy(desc(recipes.createdAt))
    .limit(20);
  let aiFailed = false;
  const generate = async (req: DraftGenerateRequest) => {
    const result = await generateRecipe(
      {
        cuisine: req.cuisine, targetPerServing: ctx.avgTarget,
        allergies: ctx.allergies, dislikes: ctx.dislikes,
        dietTags: req.dietTags, avoidNames: req.avoidNames,
      },
      gen,
    );
    if (result === null) aiFailed = true;
    return result;
  };

  const days = await draftWeek({
    favourites: ctx.favourites, cuisines: ctx.config.cuisines,
    recentNames: recent.map((r) => r.name),
    pinned, vegetarianNights: ctx.config.vegetarianNights, generate,
  });

  for (const dinner of days) {
    if (pinned.has(dinner.day)) continue; // already persisted
    await persistDinner(db, plan.id, dinner, ctx.targets);
  }
  // a re-plan invalidates any existing list
  await db.delete(shoppingLists).where(eq(shoppingLists.weekPlanId, plan.id));
  return { aiDegraded: aiFailed };
}

/** Replace one day. mode: 'favourite' | 'ai' | 'ai-same-cuisine', or pass an explicit recipeId. */
export async function swapDay(
  db: Db,
  weekStart: string,
  day: number,
  mode: 'favourite' | 'ai' | 'ai-same-cuisine' | { recipeId: string },
  gen: Generator = aiGenerator,
): Promise<{ ok: boolean }> {
  const ctx = await loadContext(db);
  const plan = await getOrCreateWeekPlan(db, weekStart);
  const week = await db.select().from(plannedDinners).where(eq(plannedDinners.weekPlanId, plan.id));
  const current = week.find((d) => d.day === day);
  const currentRecipe = current
    ? (await db.select().from(recipes).where(eq(recipes.id, current.recipeId)))[0]
    : null;
  const usedNames = new Set<string>();
  for (const d of week) {
    const [r] = await db.select().from(recipes).where(eq(recipes.id, d.recipeId));
    if (r) usedNames.add(r.name.toLowerCase());
  }

  let replacement: DraftDinner | null = null;
  if (typeof mode === 'object') {
    const [r] = await db.select().from(recipes).where(eq(recipes.id, mode.recipeId));
    if (r) replacement = { day, source: r.source === 'ai' ? 'ai' : 'favourite', recipeId: r.id, recipe: r };
  } else if (mode === 'favourite') {
    const fav = ctx.favourites.find((f) => !usedNames.has(f.name.toLowerCase()));
    if (fav) replacement = { day, source: 'favourite', recipeId: fav.id, recipe: fav };
  } else {
    const cuisine =
      mode === 'ai-same-cuisine' && currentRecipe ? currentRecipe.cuisine : (ctx.config.cuisines[0] ?? 'any');
    const ai = await generateRecipe(
      {
        cuisine, targetPerServing: ctx.avgTarget,
        allergies: ctx.allergies, dislikes: ctx.dislikes,
        dietTags: [], avoidNames: [...usedNames],
      },
      gen,
    );
    if (ai) replacement = { day, source: 'ai', recipe: ai };
  }
  if (!replacement) return { ok: false };

  await db.delete(plannedDinners).where(
    and(eq(plannedDinners.weekPlanId, plan.id), eq(plannedDinners.day, day)),
  );
  await persistDinner(db, plan.id, replacement, ctx.targets);
  await db.delete(shoppingLists).where(eq(shoppingLists.weekPlanId, plan.id));
  return { ok: true };
}

export async function togglePin(db: Db, weekStart: string, day: number): Promise<void> {
  const plan = await getOrCreateWeekPlan(db, weekStart);
  const [row] = await db.select().from(plannedDinners)
    .where(and(eq(plannedDinners.weekPlanId, plan.id), eq(plannedDinners.day, day)));
  if (row) {
    await db.update(plannedDinners).set({ pinned: !row.pinned }).where(eq(plannedDinners.id, row.id));
  }
}

/** Everything the Plan page needs in one call. */
export async function getWeek(db: Db, weekStart: string) {
  const ctx = await loadContext(db);
  const plan = await getOrCreateWeekPlan(db, weekStart);
  const rows = await db.select().from(plannedDinners).where(eq(plannedDinners.weekPlanId, plan.id));
  const dinners = await Promise.all(
    rows.sort((a, b) => a.day - b.day).map(async (row) => {
      const [recipe] = await db.select().from(recipes).where(eq(recipes.id, row.recipeId));
      return { ...row, recipe };
    }),
  );
  const nightly = dinners.map((d) => scale(d.recipe.perServing, d.householdServings));
  const tally = weeklyTally(nightly, weeklyTargetFor(ctx.targets.map((t) => t.target), 7));
  return { plan, dinners, tally, people: ctx.household, settings: ctx.config };
}
