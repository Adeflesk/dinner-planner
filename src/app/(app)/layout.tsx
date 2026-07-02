import Link from 'next/link';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl p-4">
      <nav className="mb-6 flex gap-4 border-b pb-3 text-sm font-medium">
        <Link href="/" className="hover:underline">Plan</Link>
        <Link href="/shopping" className="hover:underline">Shopping</Link>
        <Link href="/recipes" className="hover:underline">Recipes</Link>
        <Link href="/family" className="hover:underline">Family</Link>
      </nav>
      {children}
    </div>
  );
}
