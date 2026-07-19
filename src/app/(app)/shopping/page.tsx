import Link from 'next/link';
import { getDb } from '@/lib/db';
import { resolveWeekStart } from '@/lib/services/dates';
import { decodeStapleUndo, getList, stapleNameSet, staplesCheck, weekHasDinners } from '@/lib/services/shopping';
import { SECTION_ORDER } from '@/lib/macro/aggregate';
import { canonicalName } from '@/lib/macro/canon';
import {
  addItemAction, buildListAction, markStapleAction, removeItemAction,
  toggleItemAction, undoStapleAction,
} from '@/app/actions/shopping';
import { WeekTabs } from '../WeekTabs';

export const dynamic = 'force-dynamic';

const SECTION_LABEL: Record<string, string> = {
  produce: 'Produce', meat_fish: 'Meat & fish', dairy: 'Dairy',
  pantry: 'Pantry', frozen: 'Frozen', other: 'Other',
};
const fmtQty = (n: number) => (Number.isInteger(n) ? n : Math.round(n * 100) / 100);

export default async function ShoppingPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; undo?: string }>;
}) {
  const { week: weekParam, undo: undoParam } = await searchParams;
  const isNext = weekParam === 'next';
  const weekRaw = isNext ? 'next' : '';
  const db = getDb();
  const weekStart = resolveWeekStart(isNext ? 'next' : undefined);
  const list = await getList(db, weekStart);

  if (!list) {
    // No dinners → nothing to build a list from; don't offer an empty build.
    if (!(await weekHasDinners(db, weekStart))) {
      return (
        <main className="mx-auto w-full max-w-lg space-y-4">
          <div>
            <h1 className="font-display text-[27px]">Shopping list</h1>
            <p className="eyebrow mt-1">Week of {weekStart}</p>
            <div className="mt-2.5"><WeekTabs basePath="/shopping" isNext={isNext} /></div>
          </div>
          <p className="card p-4 text-sm">
            No dinners planned yet — <Link href={isNext ? '/?week=next' : '/'} className="text-bottle underline underline-offset-3">plan your week first</Link>,
            then build the list from it.
          </p>
        </main>
      );
    }
    const used = await staplesCheck(db, weekStart);
    return (
      <main className="mx-auto w-full max-w-lg space-y-4">
        <div>
          <h1 className="font-display text-[27px]">Shopping list</h1>
          <p className="eyebrow mt-1">Week of {weekStart}</p>
          <div className="mt-2.5"><WeekTabs basePath="/shopping" isNext={isNext} /></div>
        </div>
        <form action={buildListAction} className="card space-y-4 border-t-[3px] border-t-bottle p-5 text-sm">
          <input type="hidden" name="week" value={weekRaw} />
          {used.length > 0 ? (
            <>
              <p className="font-medium">This week&apos;s dinners use these staples — tick any you&apos;re running low on:</p>
              <ul className="space-y-2.5">
                {used.map((s) => (
                  <li key={`${s.name}|${s.unit}`}>
                    <label className="flex cursor-pointer items-center gap-3">
                      <input type="checkbox" name="lowStaple" value={s.name} className="tick" />
                      <span>{s.name}</span>
                      <span className="font-data text-xs text-soft">needs ~{fmtQty(s.quantity)} {s.unit}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>No pantry staples needed this week.</p>
          )}
          <button className="btn btn-primary">Build shopping list</button>
        </form>
      </main>
    );
  }

  const sections = SECTION_ORDER.filter((s) => list.items.some((i) => i.section === s));
  const remaining = list.items.filter((i) => !i.checked).length;
  const stapleSet = await stapleNameSet(db);
  const undo = undoParam ? decodeStapleUndo(undoParam) : null;
  return (
    <main className="mx-auto w-full max-w-lg space-y-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[27px]">Shopping</h1>
          <p className="eyebrow mt-1">
            Week of {weekStart} · <span className="text-bottle">{remaining} to get</span>
          </p>
          <div className="mt-2.5"><WeekTabs basePath="/shopping" isNext={isNext} /></div>
        </div>
        <form action={buildListAction}>
          <input type="hidden" name="week" value={weekRaw} />
          <button className="btn btn-ghost">Rebuild</button>
        </form>
      </div>

      {undo && (
        <div className="card flex items-center gap-3 border-l-[3px] border-l-bottle p-4 text-sm">
          <p className="flex-1">
            Marked <strong>{undo.name}</strong> as a pantry staple — it won&apos;t appear on future lists.
          </p>
          <form action={undoStapleAction}>
            <input type="hidden" name="listId" value={list.id} />
            <input type="hidden" name="week" value={weekRaw} />
            <input type="hidden" name="undo" value={undoParam} />
            <button className="btn btn-ghost">Undo</button>
          </form>
        </div>
      )}

      {sections.map((section) => (
        <section key={section} className="card overflow-hidden">
          <h2 className="eyebrow border-b border-line border-l-[3px] border-l-bottle bg-porcelain px-4 py-2">
            {SECTION_LABEL[section]}
          </h2>
          <ul>
            {list.items.map((item, index) =>
              item.section !== section ? null : (
                <li key={index} className="flex min-h-11 items-center gap-3 border-b border-line px-4 py-1.5 last:border-b-0">
                  <form action={toggleItemAction} className="flex">
                    <input type="hidden" name="listId" value={list.id} />
                    <input type="hidden" name="index" value={index} />
                    <button
                      aria-label={item.checked ? `Uncheck ${item.name}` : `Check off ${item.name}`}
                      className={`grid h-8 w-8 -m-1.5 place-content-center`}
                    >
                      <span
                        className={`grid h-[19px] w-[19px] place-content-center rounded border text-[11px] leading-none ${
                          item.checked ? 'border-bottle bg-bottle text-white' : 'border-line bg-card'
                        }`}
                      >
                        {item.checked ? '✓' : ''}
                      </span>
                    </button>
                  </form>
                  <span className={`text-sm ${item.checked ? 'text-soft line-through' : ''}`}>
                    <span className="font-data text-[13px]">{fmtQty(item.quantity)} {item.unit}</span>{' '}
                    {item.name}
                    {item.manual && <em className="text-soft"> · added</em>}
                  </span>
                  <div className="ml-auto flex items-center gap-1">
                    {!stapleSet.has(canonicalName(item.name)) && (
                      <form action={markStapleAction} className="flex">
                        <input type="hidden" name="listId" value={list.id} />
                        <input type="hidden" name="index" value={index} />
                        <input type="hidden" name="week" value={weekRaw} />
                        <button
                          aria-label={`Mark ${item.name} as a pantry staple`}
                          title={`Mark ${item.name} as a pantry staple`}
                          className="grid h-8 w-8 -m-1.5 place-content-center text-soft hover:text-bottle"
                        >
                          ⌂
                        </button>
                      </form>
                    )}
                    <form action={removeItemAction} className="flex">
                      <input type="hidden" name="listId" value={list.id} />
                      <input type="hidden" name="index" value={index} />
                      <button
                        aria-label={`Remove ${item.name}`}
                        className="grid h-8 w-8 -m-1.5 place-content-center text-soft hover:text-tomato"
                      >
                        ×
                      </button>
                    </form>
                  </div>
                </li>
              ),
            )}
          </ul>
        </section>
      ))}

      <form action={addItemAction} className="flex gap-2">
        <input type="hidden" name="listId" value={list.id} />
        <input name="name" placeholder="Add item…" className="field flex-1" />
        <button className="btn btn-primary">Add</button>
      </form>
    </main>
  );
}
