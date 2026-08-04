import Link from 'next/link';
import { DAY_NAMES } from '@/lib/services/dates';
import { swapDayAction } from '@/app/actions/plan';
import type { PickerOption } from '@/lib/services/planning';

const PILL =
  'rounded-full border border-line px-3 py-1 text-xs text-soft hover:border-bottle hover:text-bottle';

/** Opens the picker panel below the week grid. Navigation only — no JS. */
export function PickLink({ day, week }: { day: number; week: string }) {
  return (
    <Link href={`/?pick=${day}${week === 'next' ? '&week=next' : ''}#pick`} className={PILL}>
      Pick manually
    </Link>
  );
}

/** The manual-pick panel: search, then one row per recipe in the library. */
export function PickerPanel({
  day, week, query, options, dayLabel,
}: {
  day: number; week: string; query: string; options: PickerOption[]; dayLabel: string;
}) {
  const closeHref = week === 'next' ? '/?week=next' : '/';
  return (
    <section id="pick" aria-label="Pick a dinner" className="card p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-[19px]">Pick a dinner for {dayLabel}</h2>
        <Link className="text-xs text-soft hover:text-bottle" href={closeHref}>close</Link>
      </div>

      <form className="mt-3 flex gap-2" action="/">
        <input type="hidden" name="pick" value={day} />
        {week === 'next' && <input type="hidden" name="week" value="next" />}
        <input
          name="q"
          defaultValue={query}
          placeholder="Search by name"
          className="w-full rounded-md border border-line px-2.5 py-1.5 text-sm"
        />
        <button className={PILL}>Search</button>
      </form>

      <p className="eyebrow mt-3">{options.length} {options.length === 1 ? 'recipe' : 'recipes'}</p>

      {options.length === 0 ? (
        <p className="mt-2 text-sm text-soft">
          {query ? `Nothing matches “${query}”.` : 'No recipes yet — add one on the Recipes page.'}
        </p>
      ) : (
        <ul className="mt-1.5 max-h-[320px] divide-y divide-line overflow-y-auto">
          {options.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{o.name}</p>
                <p className="font-data text-[11px] text-soft">
                  {o.cuisine} · {o.kcal} kcal
                  {!o.favourite && ' · from a past plan'}
                  {o.plannedDay !== null && ` · already on ${DAY_NAMES[o.plannedDay]}`}
                </p>
              </div>
              <form action={swapDayAction}>
                <input type="hidden" name="day" value={day} />
                <input type="hidden" name="week" value={week} />
                <input type="hidden" name="mode" value="pick" />
                <input type="hidden" name="recipeId" value={o.id} />
                <button className={PILL}>Use</button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
