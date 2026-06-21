import { getDb } from '@/lib/db';
import { pantryStaples, people, settings } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { dailyTargets, dinnerTargets } from '@/lib/macro/targets';
import { addStaple, deletePerson, removeStaple, saveSettings } from '@/app/actions/family';
import { PersonForm } from './PersonForm';

export const dynamic = 'force-dynamic';

export default async function FamilyPage() {
  const db = getDb();
  const household = await db.select().from(people);
  const [config] = await db.select().from(settings).where(eq(settings.id, 1));
  const staples = await db.select().from(pantryStaples);
  const share = config?.dinnerShare ?? 0.35;

  return (
    <main className="space-y-8">
      <section>
        <h1 className="mb-3 text-2xl font-bold">Family</h1>
        <ul className="space-y-2">
          {household.map((p) => {
            const daily = dailyTargets(p);
            const dinner = dinnerTargets(p, share);
            return (
              <li key={p.id} className="rounded border p-3">
                <div className="flex items-center justify-between">
                  <strong>{p.name}</strong>
                  <form action={deletePerson}>
                    <input type="hidden" name="id" value={p.id} />
                    <button className="text-sm text-red-600">remove</button>
                  </form>
                </div>
                <p className="text-sm text-gray-600">
                  {p.age}y · {p.weightKg}kg · {p.goal} · daily {Math.round(daily.kcal)} kcal
                  · dinner target {Math.round(dinner.kcal)} kcal / P{Math.round(dinner.protein)}g
                </p>
                {p.allergies.length > 0 && <p className="text-sm text-red-700">allergies: {p.allergies.join(', ')}</p>}
                {p.dislikes.length > 0 && <p className="text-sm text-gray-500">dislikes: {p.dislikes.join(', ')}</p>}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="rounded border p-4">
        <h2 className="mb-2 font-semibold">Add person</h2>
        <PersonForm />
      </section>

      <section className="rounded border p-4">
        <h2 className="mb-2 font-semibold">Household settings</h2>
        <form action={saveSettings} className="flex flex-wrap items-end gap-3 text-sm">
          <label>Dinner share (% of daily kcal)
            <input name="dinnerShare" type="number" min="10" max="60" defaultValue={Math.round(share * 100)} className="block rounded border p-2" />
          </label>
          <label>Preferred cuisines (comma-separated)
            <input name="cuisines" defaultValue={(config?.cuisines ?? []).join(', ')} className="block w-72 rounded border p-2" />
          </label>
          <label>Vegetarian nights / week
            <input name="vegetarianNights" type="number" min="0" max="7" defaultValue={config?.vegetarianNights ?? 0} className="block rounded border p-2" />
          </label>
          <button className="rounded bg-emerald-700 p-2 text-white">Save settings</button>
        </form>
      </section>

      <section className="rounded border p-4">
        <h2 className="mb-2 font-semibold">Pantry staples (never on the list unless you flag them low)</h2>
        <ul className="mb-3 flex flex-wrap gap-2">
          {staples.map((s) => (
            <li key={s.id} className="flex items-center gap-1 rounded bg-gray-100 px-2 py-1 text-sm">
              {s.name}
              <form action={removeStaple}><input type="hidden" name="id" value={s.id} /><button className="text-red-600">x</button></form>
            </li>
          ))}
        </ul>
        <form action={addStaple} className="flex gap-2 text-sm">
          <input name="name" placeholder="e.g. olive oil" className="rounded border p-2" />
          <button className="rounded bg-emerald-700 px-3 text-white">Add</button>
        </form>
      </section>
    </main>
  );
}
