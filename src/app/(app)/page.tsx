import Link from 'next/link';
import { getDb } from '@/lib/db';
import { currentWeekStart, DAY_NAMES } from '@/lib/services/dates';
import { getWeek } from '@/lib/services/planning';
import { planMyWeek, swapDayAction, togglePinAction } from '@/app/actions/plan';

export const dynamic = 'force-dynamic';

const STATUS_ICON = { ok: '✓', over: '▲', under: '▼' } as const;

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ degraded?: string }>;
}) {
  const { degraded } = await searchParams;
  const weekStart = currentWeekStart();
  const week = await getWeek(getDb(), weekStart);
  const personName = (id: string) => week.people.find((p) => p.id === id)?.name ?? '?';

  return (
    <main className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Week of {weekStart}</h1>
        <div className="flex gap-2">
          <form action={planMyWeek}>
            <button className="rounded bg-emerald-700 px-3 py-2 text-sm text-white">
              {week.dinners.length ? 'Re-plan week' : 'Plan my week'}
            </button>
          </form>
          <Link href="/shopping" className="rounded border px-3 py-2 text-sm">Shopping list</Link>
        </div>
      </div>

      {degraded && (
        <p className="rounded bg-amber-100 p-2 text-sm">
          AI suggestions were unavailable — this week was drafted from favourites only.
        </p>
      )}

      {week.people.length === 0 && (
        <p className="rounded bg-blue-50 p-3 text-sm">
          Start by adding your family on the <Link className="underline" href="/family">Family page</Link>,
          and a few favourite dinners on the <Link className="underline" href="/recipes">Recipes page</Link>.
        </p>
      )}

      {week.dinners.length > 0 && (
        <p className="rounded bg-gray-50 p-2 text-sm">
          Week macros vs target:{' '}
          {(['kcal', 'protein', 'carbs', 'fat'] as const).map((k) => (
            <span key={k} className="mr-3">
              {k} {Math.round(week.tally.totals[k])} {STATUS_ICON[week.tally.status[k]]}
            </span>
          ))}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 7 }, (_, day) => {
          const dinner = week.dinners.find((d) => d.day === day);
          return (
            <div key={day} className="rounded border p-3 text-sm">
              <div className="flex items-center justify-between">
                <strong>{DAY_NAMES[day]}</strong>
                {dinner && (
                  <form action={togglePinAction}>
                    <input type="hidden" name="day" value={day} />
                    <button title={dinner.pinned ? 'Unpin' : 'Pin (survives re-plan)'}>
                      {dinner.pinned ? '[pinned]' : '[pin]'}
                    </button>
                  </form>
                )}
              </div>
              {dinner ? (
                <>
                  <p className="font-medium">{dinner.recipe.name}</p>
                  <p className="text-gray-600">
                    {dinner.recipe.cuisine} · {Math.round(dinner.recipe.perServing.kcal)} kcal/serv
                    {dinner.recipe.tags.includes('vegetarian') && ' · veg'}
                  </p>
                  {dinner.portions.some((p) => !p.withinTolerance) && (
                    <p className="text-amber-700">portions off-target for some people</p>
                  )}
                  <details className="mt-1">
                    <summary className="cursor-pointer text-gray-500">portions & recipe</summary>
                    <table className="mt-1 w-full">
                      <tbody>
                        {dinner.portions.map((p) => (
                          <tr key={p.personId}>
                            <td>{personName(p.personId)}</td>
                            <td>x{p.servings}</td>
                            <td>{Math.round(p.achieved.kcal)} kcal {p.withinTolerance ? '' : '!'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <ul className="ml-4 mt-1 list-disc">
                      {dinner.recipe.ingredients.map((i, idx) => (
                        <li key={idx}>{i.quantity} {i.unit} {i.name}</li>
                      ))}
                    </ul>
                    <p className="mt-1 whitespace-pre-wrap text-gray-700">{dinner.recipe.method}</p>
                  </details>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {(['favourite', 'ai', 'ai-same-cuisine'] as const).map((mode) => (
                      <form key={mode} action={swapDayAction}>
                        <input type="hidden" name="day" value={day} />
                        <input type="hidden" name="mode" value={mode} />
                        <button className="rounded border px-1.5 py-0.5 text-xs">
                          {mode === 'favourite' ? 'favourite' : mode === 'ai' ? 'new AI idea' : `more ${dinner.recipe.cuisine}`}
                        </button>
                      </form>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-gray-400">—</p>
              )}
            </div>
          );
        })}
      </div>
    </main>
  );
}
