import Link from 'next/link';
import { getDb } from '@/lib/db';
import { currentWeekStart } from '@/lib/services/dates';
import { getList, staplesCheck, weekHasDinners } from '@/lib/services/shopping';
import { SECTION_ORDER } from '@/lib/macro/aggregate';
import { addItemAction, buildListAction, removeItemAction, toggleItemAction } from '@/app/actions/shopping';

export const dynamic = 'force-dynamic';

const SECTION_LABEL: Record<string, string> = {
  produce: 'Produce', meat_fish: 'Meat & fish', dairy: 'Dairy',
  pantry: 'Pantry', frozen: 'Frozen', other: 'Other',
};
const fmtQty = (n: number) => (Number.isInteger(n) ? n : Math.round(n * 100) / 100);

export default async function ShoppingPage() {
  const db = getDb();
  const weekStart = currentWeekStart();
  const list = await getList(db, weekStart);

  if (!list) {
    // No dinners → nothing to build a list from; don't offer an empty build.
    if (!(await weekHasDinners(db, weekStart))) {
      return (
        <main className="max-w-lg space-y-4">
          <h1 className="text-2xl font-bold">Shopping list — week of {weekStart}</h1>
          <p className="rounded bg-blue-50 p-3 text-sm">
            No dinners planned yet — <Link href="/" className="underline">plan your week first</Link>,
            then build the list from it.
          </p>
        </main>
      );
    }
    const used = await staplesCheck(db, weekStart);
    return (
      <main className="max-w-lg space-y-4">
        <h1 className="text-2xl font-bold">Shopping list — week of {weekStart}</h1>
        <form action={buildListAction} className="space-y-3 rounded border p-4 text-sm">
          {used.length > 0 ? (
            <>
              <p className="font-medium">This week&apos;s dinners use these staples — tick any you&apos;re running low on:</p>
              <ul className="space-y-1">
                {used.map((s) => (
                  <li key={`${s.name}|${s.unit}`}>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" name="lowStaple" value={s.name} />
                      {s.name} <span className="text-gray-500">(needs ~{fmtQty(s.quantity)} {s.unit})</span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>No pantry staples needed this week.</p>
          )}
          <button className="rounded bg-emerald-700 px-3 py-2 text-white">Build shopping list</button>
        </form>
      </main>
    );
  }

  const sections = SECTION_ORDER.filter((s) => list.items.some((i) => i.section === s));
  return (
    <main className="max-w-lg space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Shopping — week of {weekStart}</h1>
        <form action={buildListAction}>
          <button className="rounded border px-2 py-1 text-sm">Rebuild</button>
        </form>
      </div>
      {sections.map((section) => (
        <section key={section}>
          <h2 className="mb-1 font-semibold">{SECTION_LABEL[section]}</h2>
          <ul className="space-y-1 text-sm">
            {list.items.map((item, index) =>
              item.section !== section ? null : (
                <li key={index} className="flex items-center gap-2">
                  <form action={toggleItemAction}>
                    <input type="hidden" name="listId" value={list.id} />
                    <input type="hidden" name="index" value={index} />
                    <button className="w-6 text-left">{item.checked ? '[x]' : '[ ]'}</button>
                  </form>
                  <span className={item.checked ? 'text-gray-400 line-through' : ''}>
                    {fmtQty(item.quantity)} {item.unit} {item.name}
                    {item.manual && <em className="text-gray-400"> (added)</em>}
                  </span>
                  <form action={removeItemAction} className="ml-auto">
                    <input type="hidden" name="listId" value={list.id} />
                    <input type="hidden" name="index" value={index} />
                    <button className="text-xs text-red-500">x</button>
                  </form>
                </li>
              ),
            )}
          </ul>
        </section>
      ))}
      <form action={addItemAction} className="flex gap-2 text-sm">
        <input type="hidden" name="listId" value={list.id} />
        <input name="name" placeholder="Add item..." className="rounded border p-2" />
        <button className="rounded bg-emerald-700 px-3 text-white">Add</button>
      </form>
    </main>
  );
}
