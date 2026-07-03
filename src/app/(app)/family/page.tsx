import { getDb } from '@/lib/db';
import { pantryStaples, people, settings } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { dailyTargets, dinnerTargets } from '@/lib/macro/targets';
import { CAPABILITIES } from '@/lib/macro/equipment';
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
    <main className="space-y-9">
      <section>
        <h1 className="font-display text-[27px]">Family</h1>
        <p className="eyebrow mt-1 mb-3.5">{household.length} at the table</p>
        <ul className="grid gap-2.5 sm:grid-cols-2">
          {household.map((p) => {
            const daily = dailyTargets(p);
            const dinner = dinnerTargets(p, share);
            return (
              <li key={p.id} className="card p-4">
                <div className="flex items-center justify-between">
                  <strong className="font-display text-[17px] font-normal">{p.name}</strong>
                  <form action={deletePerson}>
                    <input type="hidden" name="id" value={p.id} />
                    <button className="text-xs text-soft hover:text-tomato">remove</button>
                  </form>
                </div>
                <p className="mt-1 flex flex-wrap gap-x-3 font-data text-xs text-soft">
                  <span>{p.age}y</span>
                  <span>{p.weightKg} kg</span>
                  <span>{p.goal}</span>
                  <span>daily {Math.round(daily.kcal)} kcal</span>
                  <span className="text-bottle">dinner {Math.round(dinner.kcal)} kcal · P{Math.round(dinner.protein)}g</span>
                </p>
                {p.allergies.length > 0 && (
                  <p className="mt-1.5 text-sm text-tomato">allergies: {p.allergies.join(', ')}</p>
                )}
                {p.dislikes.length > 0 && (
                  <p className="mt-0.5 text-sm text-soft">dislikes: {p.dislikes.join(', ')}</p>
                )}
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-bottle">Edit</summary>
                  <div className="mt-2">
                    <PersonForm person={p} />
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="card border-t-3 border-t-bottle p-5">
        <h2 className="mb-3 font-display text-[19px]">Add a person</h2>
        <PersonForm />
      </section>

      <section className="card p-5">
        <h2 className="mb-3 font-display text-[19px]">Household settings</h2>
        <form action={saveSettings} className="space-y-4 text-sm">
          <div className="flex flex-wrap items-end gap-4">
            <label className="space-y-1">
              <span className="eyebrow block">Dinner share · % of daily kcal</span>
              <input name="dinnerShare" type="number" min="10" max="60" defaultValue={Math.round(share * 100)} className="field w-28" />
            </label>
            <label className="grow space-y-1">
              <span className="eyebrow block">Preferred cuisines · comma-separated</span>
              <input name="cuisines" defaultValue={(config?.cuisines ?? []).join(', ')} className="field max-w-md" />
            </label>
            <label className="space-y-1">
              <span className="eyebrow block">Vegetarian nights / week</span>
              <input name="vegetarianNights" type="number" min="0" max="7" defaultValue={config?.vegetarianNights ?? 0} className="field w-28" />
            </label>
          </div>
          <fieldset>
            <legend className="eyebrow mb-1.5">Kitchen equipment</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {CAPABILITIES.map((cap) => (
                <label key={cap} className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    name="equipment"
                    value={cap}
                    defaultChecked={(config?.equipment ?? []).includes(cap)}
                    className="tick"
                  />
                  {cap}
                </label>
              ))}
            </div>
          </fieldset>
          <button className="btn btn-primary">Save settings</button>
        </form>
      </section>

      <section className="card p-5">
        <h2 className="mb-1 font-display text-[19px]">Pantry staples</h2>
        <p className="mb-3 text-sm text-soft">Always stocked — never on the list unless you flag them low.</p>
        <ul className="mb-3.5 flex flex-wrap gap-2">
          {staples.map((s) => (
            <li key={s.id} className="chip">
              {s.name}
              <form action={removeStaple}>
                <input type="hidden" name="id" value={s.id} />
                <button aria-label={`Remove ${s.name}`} className="text-soft hover:text-tomato">×</button>
              </form>
            </li>
          ))}
        </ul>
        <form action={addStaple} className="flex gap-2 text-sm">
          <input name="name" placeholder="e.g. olive oil" className="field max-w-60" />
          <button className="btn btn-primary">Add</button>
        </form>
      </section>
    </main>
  );
}
