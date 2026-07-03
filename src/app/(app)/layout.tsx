import Link from 'next/link';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-16 sm:px-6">
      <header className="mb-7 flex items-baseline justify-between border-b border-line pb-3.5 pt-5">
        <Link href="/" className="font-display text-lg tracking-tight no-underline">
          Dinner<span className="text-bottle">&hairsp;Planner</span>
        </Link>
        <nav className="flex gap-4 text-sm sm:gap-6">
          <Link href="/" className="text-soft hover:text-ink">Plan</Link>
          <Link href="/shopping" className="text-soft hover:text-ink">Shopping</Link>
          <Link href="/recipes" className="text-soft hover:text-ink">Recipes</Link>
          <Link href="/family" className="text-soft hover:text-ink">Family</Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
