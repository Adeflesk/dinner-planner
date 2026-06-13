import { login } from '@/app/actions/auth';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto mt-24 max-w-sm p-6">
      <h1 className="mb-4 text-2xl font-bold">Dinner Planner</h1>
      <form action={login} className="space-y-3">
        <input
          type="password" name="password" placeholder="Household password" required
          className="w-full rounded border p-2"
        />
        {error && <p className="text-sm text-red-600">Wrong password.</p>}
        <button type="submit" className="w-full rounded bg-emerald-700 p-2 text-white">
          Enter
        </button>
      </form>
    </main>
  );
}
