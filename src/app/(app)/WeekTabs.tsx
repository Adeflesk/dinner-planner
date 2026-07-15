import Link from 'next/link';

/** This week · Next week toggle. Pure links — week state lives in the URL. */
export function WeekTabs({ basePath, isNext }: { basePath: string; isNext: boolean }) {
  const tab = (active: boolean) =>
    `eyebrow pb-0.5 ${active ? 'border-b-2 border-dijon text-ink' : 'hover:text-ink'}`;
  return (
    <nav aria-label="Week" className="flex gap-4">
      <Link href={basePath} aria-current={!isNext ? 'page' : undefined} className={tab(!isNext)}>This week</Link>
      <Link href={`${basePath}?week=next`} aria-current={isNext ? 'page' : undefined} className={tab(isNext)}>Next week</Link>
    </nav>
  );
}
