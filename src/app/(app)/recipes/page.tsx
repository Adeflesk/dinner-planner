import { desc } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { recipes } from '@/lib/db/schema';
import { deleteRecipe, promoteToFavourite, saveRecipe } from '@/app/actions/recipes';

export const dynamic = 'force-dynamic';

export default async function RecipesPage() {
  const all = await getDb().select().from(recipes).orderBy(desc(recipes.createdAt));
  const favourites = all.filter((r) => r.source === 'family');
  const aiOnes = all.filter((r) => r.source === 'ai');

  return (
    <main className="space-y-8">
      <section>
        <h1 className="mb-3 text-2xl font-bold">Favourites ({favourites.length})</h1>
        <ul className="grid gap-2 sm:grid-cols-2">
          {favourites.map((r) => (
            <li key={r.id} className="rounded border p-3 text-sm">
              <div className="flex justify-between">
                <strong>{r.name}</strong>
                <form action={deleteRecipe}>
                  <input type="hidden" name="id" value={r.id} />
                  <button className="text-red-600">remove</button>
                </form>
              </div>
              <p className="text-gray-600">
                {r.cuisine} · {Math.round(r.perServing.kcal)} kcal · P{Math.round(r.perServing.protein)} C{Math.round(r.perServing.carbs)} F{Math.round(r.perServing.fat)}
                {r.tags.length > 0 && <> · {r.tags.join(', ')}</>}
              </p>
              <details className="mt-1">
                <summary className="cursor-pointer text-gray-500">ingredients & method</summary>
                <ul className="ml-4 list-disc">
                  {r.ingredients.map((i, idx) => <li key={idx}>{i.quantity} {i.unit} {i.name}</li>)}
                </ul>
                <p className="mt-1 whitespace-pre-wrap">{r.method}</p>
              </details>
            </li>
          ))}
        </ul>
      </section>

      {aiOnes.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">AI-suggested (from past plans)</h2>
          <ul className="space-y-1 text-sm">
            {aiOnes.map((r) => (
              <li key={r.id} className="flex items-center gap-3">
                {r.name} ({r.cuisine})
                <form action={promoteToFavourite}>
                  <input type="hidden" name="id" value={r.id} />
                  <button className="text-emerald-700 underline">save as favourite</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded border p-4">
        <h2 className="mb-2 font-semibold">Add recipe</h2>
        <form action={saveRecipe} className="grid gap-2 text-sm">
          <div className="grid grid-cols-3 gap-2">
            <input name="name" placeholder="Name" required className="rounded border p-2" />
            <input name="cuisine" placeholder="Cuisine (e.g. italian)" className="rounded border p-2" />
            <input name="servings" type="number" defaultValue={4} className="rounded border p-2" />
          </div>
          <textarea name="ingredients" rows={4} required className="rounded border p-2"
            placeholder={'One ingredient per line, e.g.\n500 g chicken breast\n2 pcs onion'} />
          <textarea name="method" rows={3} placeholder="Method (optional)" className="rounded border p-2" />
          <input name="tags" placeholder="Tags, comma-separated (e.g. vegetarian)" className="rounded border p-2" />
          <div className="grid grid-cols-4 gap-2">
            <input name="kcal" type="number" placeholder="kcal/serving" className="rounded border p-2" />
            <input name="protein" type="number" placeholder="protein g" className="rounded border p-2" />
            <input name="carbs" type="number" placeholder="carbs g" className="rounded border p-2" />
            <input name="fat" type="number" placeholder="fat g" className="rounded border p-2" />
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="estimateWithAi" defaultChecked />
            Estimate macros & store sections with AI (overrides the numbers above)
          </label>
          <button className="rounded bg-emerald-700 p-2 text-white">Save recipe</button>
        </form>
      </section>
    </main>
  );
}
