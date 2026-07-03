import { desc } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { recipes } from '@/lib/db/schema';
import { CAPABILITIES } from '@/lib/macro/equipment';
import { deleteRecipe, promoteToFavourite, saveRecipe } from '@/app/actions/recipes';

export const dynamic = 'force-dynamic';

export default async function RecipesPage() {
  const all = await getDb().select().from(recipes).orderBy(desc(recipes.createdAt));
  const favourites = all.filter((r) => r.source === 'family');
  const aiOnes = all.filter((r) => r.source === 'ai');

  return (
    <main className="space-y-9">
      <section>
        <h1 className="font-display text-[27px]">Favourites</h1>
        <p className="eyebrow mt-1 mb-3.5">{favourites.length} in the book</p>
        <ul className="grid gap-2.5 sm:grid-cols-2">
          {favourites.map((r) => (
            <li key={r.id} className="card p-4 text-sm">
              <div className="flex items-start justify-between gap-3">
                <strong className="font-display text-[17px] leading-snug font-normal">{r.name}</strong>
                <form action={deleteRecipe}>
                  <input type="hidden" name="id" value={r.id} />
                  <button className="text-xs text-soft hover:text-tomato">remove</button>
                </form>
              </div>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-data text-xs text-soft">
                <span>{r.cuisine}</span>
                <span>{Math.round(r.perServing.kcal)} kcal</span>
                <span>
                  P{Math.round(r.perServing.protein)} C{Math.round(r.perServing.carbs)} F{Math.round(r.perServing.fat)}
                </span>
                {r.tags.includes('vegetarian') && <span className="text-bottle">veg</span>}
                {r.equipment.map((e) => (
                  <span key={e} className="rounded-full bg-bottle-soft px-2 py-0.5 text-bottle">{e}</span>
                ))}
              </p>
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-soft hover:text-bottle">Ingredients &amp; method</summary>
                <ul className="mt-1.5 ml-4 list-disc">
                  {r.ingredients.map((i, idx) => (
                    <li key={idx}>
                      <span className="font-data text-[13px]">{i.quantity} {i.unit}</span> {i.name}
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 whitespace-pre-wrap text-soft">{r.method}</p>
              </details>
            </li>
          ))}
        </ul>
      </section>

      {aiOnes.length > 0 && (
        <section>
          <h2 className="eyebrow mb-2.5">AI-suggested · from past plans</h2>
          <ul className="card divide-y divide-line text-sm">
            {aiOnes.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                <span>{r.name}</span>
                <span className="font-data text-xs text-soft">{r.cuisine}</span>
                <form action={promoteToFavourite} className="ml-auto">
                  <input type="hidden" name="id" value={r.id} />
                  <button className="text-xs text-bottle underline underline-offset-3">Save as favourite</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card border-t-[3px] border-t-bottle p-5">
        <h2 className="mb-3 font-display text-[19px]">Add a recipe</h2>
        <form action={saveRecipe} className="grid gap-2.5 text-sm">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <input name="name" placeholder="Name" required className="field" />
            <input name="cuisine" placeholder="Cuisine (e.g. italian)" className="field" />
            <input name="servings" type="number" defaultValue={4} className="field" />
          </div>
          <textarea name="ingredients" rows={4} required className="field"
            placeholder={'One ingredient per line, e.g.\n500 g chicken breast\n2 pcs onion'} />
          <textarea name="method" rows={3} placeholder="Method (optional)" className="field" />
          <input name="tags" placeholder="Tags, comma-separated (e.g. vegetarian)" className="field" />
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <input name="kcal" type="number" placeholder="kcal/serving" className="field" />
            <input name="protein" type="number" placeholder="protein g" className="field" />
            <input name="carbs" type="number" placeholder="carbs g" className="field" />
            <input name="fat" type="number" placeholder="fat g" className="field" />
          </div>
          <fieldset>
            <legend className="eyebrow mb-1.5">Equipment used · optional</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {CAPABILITIES.map((cap) => (
                <label key={cap} className="flex cursor-pointer items-center gap-2">
                  <input type="checkbox" name="equipment" value={cap} className="tick" />
                  {cap}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" name="estimateWithAi" defaultChecked className="tick" />
            Estimate macros &amp; store sections with AI (overrides the numbers above)
          </label>
          <button className="btn btn-primary justify-self-start">Save recipe</button>
        </form>
      </section>
    </main>
  );
}
