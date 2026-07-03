import Link from 'next/link';
import { getDb } from '@/lib/db';
import { currentWeekStart, DAY_NAMES } from '@/lib/services/dates';
import { getWeek } from '@/lib/services/planning';
import { planMyWeek, swapDayAction, togglePinAction } from '@/app/actions/plan';
import { standoutTags } from '@/lib/macro/equipment';

export const dynamic = 'force-dynamic';

const MACROS = ['kcal', 'protein', 'carbs', 'fat'] as const;
const STATUS_ICON = { ok: '✓', over: '▲', under: '▼' } as const;
const utc = (iso: string, plusDays = 0) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + plusDays);
  return d;
};
const longDay = (d: Date) =>
  d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const shortDate = (d: Date) =>
  d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).toUpperCase();

type Week = Awaited<ReturnType<typeof getWeek>>;
type Dinner = Week['dinners'][number];

function SwapButtons({ day, cuisine }: { day: number; cuisine: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {(['favourite', 'ai', 'ai-same-cuisine'] as const).map((mode) => (
        <form key={mode} action={swapDayAction}>
          <input type="hidden" name="day" value={day} />
          <input type="hidden" name="mode" value={mode} />
          <button className="rounded-full border border-line px-3 py-1 text-xs text-soft hover:border-bottle hover:text-bottle">
            {mode === 'favourite' ? 'Another favourite' : mode === 'ai' ? 'New idea' : `More ${cuisine}`}
          </button>
        </form>
      ))}
    </div>
  );
}

function PinButton({ day, pinned }: { day: number; pinned: boolean }) {
  return (
    <form action={togglePinAction}>
      <input type="hidden" name="day" value={day} />
      <button
        title={pinned ? 'Unpin' : 'Pin (survives re-plan)'}
        className={`font-data text-[11px] ${pinned ? 'text-bottle' : 'text-soft hover:text-ink'}`}
      >
        {pinned ? 'pinned ●' : 'pin'}
      </button>
    </form>
  );
}

function DinnerBody({ dinner, personName }: { dinner: Dinner; personName: (id: string) => string }) {
  return (
    <>
      <table className="mt-2 w-full text-sm">
        <tbody>
          {dinner.portions.map((p) => (
            <tr key={p.personId}>
              <td className="py-0.5">{personName(p.personId)}</td>
              <td className="font-data text-bottle">×{p.servings.toFixed(2)}</td>
              <td className="font-data text-soft">
                {Math.round(p.achieved.kcal)} kcal{p.withinTolerance ? '' : ' !'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="mt-2 ml-4 list-disc text-sm">
        {dinner.recipe.ingredients.map((i, idx) => (
          <li key={idx}>
            <span className="font-data text-[13px]">{i.quantity} {i.unit}</span> {i.name}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-sm whitespace-pre-wrap text-soft">{dinner.recipe.method}</p>
    </>
  );
}

function DinnerDetail({ dinner, personName }: { dinner: Dinner; personName: (id: string) => string }) {
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-sm text-bottle underline underline-offset-3">
        Ingredients &amp; method
      </summary>
      <DinnerBody dinner={dinner} personName={personName} />
    </details>
  );
}

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ degraded?: string; planned?: string }>;
}) {
  const { degraded, planned } = await searchParams;
  const weekStart = currentWeekStart();
  const week = await getWeek(getDb(), weekStart);
  const personName = (id: string) => week.people.find((p) => p.id === id)?.name ?? '?';

  const todayIdx = (new Date().getUTCDay() + 6) % 7;
  const tonight = week.dinners.find((d) => d.day === todayIdx);
  const fill = (k: (typeof MACROS)[number]) =>
    week.weeklyTarget[k] > 0 ? Math.min(100, Math.round((week.tally.totals[k] / week.weeklyTarget[k]) * 100)) : 0;

  return (
    <main className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[27px]">Week of {longDay(utc(weekStart)).replace(/^\w+ /, '')}</h1>
          <p className="eyebrow mt-1">{shortDate(utc(weekStart))} — {shortDate(utc(weekStart, 6))}</p>
        </div>
        <div className="flex gap-2.5">
          <form action={planMyWeek}>
            <button className="btn btn-primary">
              {week.dinners.length ? 'Re-plan week' : 'Plan my week'}
            </button>
          </form>
          <Link href="/shopping" className="btn btn-ghost">Shopping list →</Link>
        </div>
      </div>

      {degraded && (
        <p className="card border-dijon bg-dijon-soft p-3 text-sm">
          AI suggestions were unavailable — this week was drafted from favourites only.
        </p>
      )}

      {planned && (
        <p className="card border-bottle bg-bottle-soft p-3 text-sm">
          Week planned — <Link className="font-medium underline underline-offset-3" href="/shopping">build your shopping list →</Link>
        </p>
      )}

      {week.people.length === 0 && (
        <p className="card p-4 text-sm">
          Start by adding your family on the <Link className="text-bottle underline underline-offset-3" href="/family">Family page</Link>,
          and a few favourite dinners on the <Link className="text-bottle underline underline-offset-3" href="/recipes">Recipes page</Link>.
        </p>
      )}

      {week.dinners.length > 0 && (
        <section aria-label="Week macros vs target" className="card grid grid-cols-1 gap-x-9 gap-y-3 p-4 sm:grid-cols-2">
          {MACROS.map((k) => (
            <div key={k} className="grid grid-cols-[64px_1fr_72px] items-center gap-3">
              <span className="eyebrow">{k}</span>
              <span className="thread-track">
                <span className="thread-weave" style={{ '--fill': fill(k) } as React.CSSProperties} />
                <span className="thread-selvage" />
              </span>
              <span className="text-right font-data text-xs whitespace-nowrap">
                {Math.round(week.tally.totals[k]).toLocaleString('en-GB')}{k === 'kcal' ? '' : ' g'}{' '}
                <span className={week.tally.status[k] === 'ok' ? 'text-bottle' : 'text-dijon'}>
                  {STATUS_ICON[week.tally.status[k]]}
                </span>
              </span>
            </div>
          ))}
        </section>
      )}

      <section aria-label="Tonight">
        <p className="eyebrow">
          <b className="font-semibold text-dijon">Tonight</b> · {longDay(utc(weekStart, todayIdx))}
        </p>
        {tonight ? (
          <article className="rise card mt-2 border-t-[3px] border-t-bottle px-5 py-5 sm:px-7">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-data text-[13px] text-soft">
              <span>{tonight.recipe.cuisine}</span>
              <span>{Math.round(tonight.recipe.perServing.kcal)} kcal / serving</span>
              {tonight.recipe.tags.includes('vegetarian') && <span className="text-bottle">veg</span>}
              {standoutTags(tonight.recipe.equipment).map((t) => (
                <span key={t} className="rounded-full bg-bottle-soft px-2.5 py-0.5 text-bottle">{t}</span>
              ))}
            </div>
            <h2 className="mt-1.5 max-w-[26ch] font-display text-[clamp(24px,3.5vw,36px)] leading-[1.15]">
              {tonight.recipe.name}
            </h2>
            <div className="mt-3.5 flex flex-wrap gap-2">
              {tonight.portions.map((p) => (
                <span key={p.personId} className="chip">
                  <b className="font-medium">{personName(p.personId)}</b>
                  <span className={`font-data text-xs ${p.withinTolerance ? 'text-bottle' : 'text-dijon'}`}>
                    ×{p.servings.toFixed(2)}
                  </span>
                </span>
              ))}
            </div>
            {tonight.portions.some((p) => !p.withinTolerance) && (
              <p className="mt-2 text-sm text-dijon">Portions are off-target for some people tonight.</p>
            )}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-dashed border-line pt-3.5">
              <div className="flex items-center gap-4">
                <DinnerDetail dinner={tonight} personName={personName} />
                <PinButton day={todayIdx} pinned={tonight.pinned} />
              </div>
              <SwapButtons day={todayIdx} cuisine={tonight.recipe.cuisine} />
            </div>
          </article>
        ) : (
          <article className="rise card mt-2 border-t-[3px] border-t-line px-5 py-6 text-sm text-soft sm:px-7">
            Nothing planned tonight{week.dinners.length === 0 && ' — plan your week to fill it'}.
          </article>
        )}
      </section>

      <section aria-label="Week at a glance">
        <p className="eyebrow mb-2.5">The week</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-7">
          {Array.from({ length: 7 }, (_, day) => {
            const dinner = week.dinners.find((d) => d.day === day);
            const today = day === todayIdx;
            return (
              <article
                key={day}
                style={{ '--i': day + 3 } as React.CSSProperties}
                className={`rise card flex min-h-0 flex-col gap-1.5 p-3 transition-transform hover:-translate-y-0.5 lg:min-h-[118px] ${
                  today ? 'border-dijon border-t-[3px] border-t-dijon bg-dijon-soft' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className={`font-data text-[10.5px] tracking-[0.1em] uppercase ${today ? 'font-semibold text-dijon' : 'text-soft'}`}>
                    {DAY_NAMES[day]}{today && ' · today'}
                  </span>
                  {dinner && <PinButton day={day} pinned={dinner.pinned} />}
                </div>
                {dinner ? (
                  <>
                    <p className="line-clamp-3 text-[13px] leading-snug font-medium">{dinner.recipe.name}</p>
                    <div className="mt-auto flex items-center gap-2 font-data text-[11px] text-soft">
                      <span>{Math.round(dinner.recipe.perServing.kcal)} kcal</span>
                      {dinner.recipe.tags.includes('vegetarian') && <span className="text-bottle">veg</span>}
                      {standoutTags(dinner.recipe.equipment).length > 0 && (
                        <span className="text-bottle" title={standoutTags(dinner.recipe.equipment).join(', ')}>
                          {standoutTags(dinner.recipe.equipment)[0]}
                        </span>
                      )}
                    </div>
                    <details>
                      <summary className="cursor-pointer text-xs text-soft hover:text-bottle">more</summary>
                      <div className="mt-1.5 space-y-2 text-sm">
                        <DinnerBody dinner={dinner} personName={personName} />
                        <SwapButtons day={day} cuisine={dinner.recipe.cuisine} />
                      </div>
                    </details>
                  </>
                ) : (
                  <p className="my-auto text-[13px] text-soft">Nothing planned</p>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
