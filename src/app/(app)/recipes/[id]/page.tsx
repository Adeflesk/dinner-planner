import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { recipes } from '@/lib/db/schema';
import { CAPABILITIES } from '@/lib/macro/equipment';
import { formatIngredientLines } from '@/lib/services/ingredients';
import { recipeHistory } from '@/lib/services/recipes';
import { promoteToFavourite, updateRecipeAction } from '@/app/actions/recipes';

export const dynamic = 'force-dynamic';

// A non-UUID id would make the uuid-typed query throw; treat it as not found instead.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cookedDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  });
}

export default async function RecipeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const db = getDb();
  const [recipe] = await db.select().from(recipes).where(eq(recipes.id, id));
  if (!recipe) notFound();
  const history = await recipeHistory(db, id);

  return (
    <main className="space-y-9">
      <section>
        <Link href="/recipes" className="text-xs text-soft hover:text-bottle">← All recipes</Link>
        <div className="mt-1.5 flex items-start justify-between gap-3">
          <h1 className="font-display text-[27px]">{recipe.name}</h1>
          {recipe.source === 'ai' && (
            <form action={promoteToFavourite}>
              <input type="hidden" name="id" value={recipe.id} />
              <button className="text-xs text-bottle underline underline-offset-3">Save as favourite</button>
            </form>
          )}
        </div>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-data text-xs text-soft">
          <span>{recipe.source === 'ai' ? 'AI-suggested' : 'family favourite'}</span>
          <span>{recipe.cuisine}</span>
          <span>{recipe.servings} servings</span>
          <span>{Math.round(recipe.perServing.kcal)} kcal</span>
          <span>
            P{Math.round(recipe.perServing.protein)} C{Math.round(recipe.perServing.carbs)} F{Math.round(recipe.perServing.fat)}
          </span>
          {recipe.tags.includes('vegetarian') && <span className="text-bottle">veg</span>}
          {recipe.equipment.map((e) => (
            <span key={e} className="rounded-full bg-bottle-soft px-2 py-0.5 text-bottle">{e}</span>
          ))}
        </p>
      </section>

      <section className="card p-5 text-sm">
        <h2 className="eyebrow mb-2.5">Ingredients</h2>
        <ul className="ml-4 list-disc">
          {recipe.ingredients.map((i, idx) => (
            <li key={idx}>
              <span className="font-data text-[13px]">{i.quantity} {i.unit}</span> {i.name}
            </li>
          ))}
        </ul>
        {recipe.method && (
          <>
            <h2 className="eyebrow mt-4 mb-1.5">Method</h2>
            <p className="whitespace-pre-wrap text-soft">{recipe.method}</p>
          </>
        )}
      </section>

      <section>
        <h2 className="eyebrow mb-2.5">Cooking history</h2>
        {history.length === 0 ? (
          <p className="text-sm text-soft">Not cooked yet.</p>
        ) : (
          <div className="card p-4 text-sm">
            <p>
              Cooked {history.length} time{history.length === 1 ? '' : 's'} · last on {cookedDate(history[0].cookedOn)}
            </p>
            <ul className="mt-2 space-y-1 font-data text-xs text-soft">
              {history.map((h) => (
                <li key={`${h.weekStart}-${h.day}`}>{cookedDate(h.cookedOn)}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="card border-t-[3px] border-t-bottle p-5">
        <h2 className="mb-3 font-display text-[19px]">Edit recipe</h2>
        <form action={updateRecipeAction} className="grid gap-2.5 text-sm">
          <input type="hidden" name="id" value={recipe.id} />
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <input name="name" defaultValue={recipe.name} required className="field" />
            <input name="cuisine" defaultValue={recipe.cuisine} className="field" />
            <input name="servings" type="number" defaultValue={recipe.servings} className="field" />
          </div>
          <textarea name="ingredients" rows={Math.max(4, recipe.ingredients.length)} required className="field"
            defaultValue={formatIngredientLines(recipe.ingredients)} />
          <textarea name="method" rows={3} defaultValue={recipe.method} placeholder="Method (optional)" className="field" />
          <input name="tags" defaultValue={recipe.tags.join(', ')} placeholder="Tags, comma-separated" className="field" />
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <input name="kcal" type="number" defaultValue={Math.round(recipe.perServing.kcal)} placeholder="kcal/serving" className="field" />
            <input name="protein" type="number" defaultValue={Math.round(recipe.perServing.protein)} placeholder="protein g" className="field" />
            <input name="carbs" type="number" defaultValue={Math.round(recipe.perServing.carbs)} placeholder="carbs g" className="field" />
            <input name="fat" type="number" defaultValue={Math.round(recipe.perServing.fat)} placeholder="fat g" className="field" />
          </div>
          <fieldset>
            <legend className="eyebrow mb-1.5">Equipment used · optional</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {CAPABILITIES.map((cap) => (
                <label key={cap} className="flex cursor-pointer items-center gap-2">
                  <input type="checkbox" name="equipment" value={cap} defaultChecked={recipe.equipment.includes(cap)} className="tick" />
                  {cap}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" name="estimateWithAi" defaultChecked className="tick" />
            Re-estimate macros &amp; store sections with AI (overrides the numbers above)
          </label>
          <button className="btn btn-primary justify-self-start">Save changes</button>
        </form>
      </section>
    </main>
  );
}
