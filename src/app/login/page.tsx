import { login } from '@/app/actions/auth';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto mt-24 w-full max-w-sm p-6">
      <div className="card border-t-[3px] border-t-bottle p-7">
        <h1 className="mb-1 font-display text-2xl">
          Dinner<span className="text-bottle">{'\u200A'}Planner</span>
        </h1>
        <p className="mb-5 text-sm text-soft">One password for the whole household.</p>
        <form action={login} className="space-y-3">
          <input
            type="password" name="password" placeholder="Household password" required
            className="field"
          />
          {error && <p className="text-sm text-tomato">Wrong password — try again.</p>}
          <button type="submit" className="btn btn-primary w-full">
            Enter the kitchen
          </button>
        </form>
      </div>
    </main>
  );
}
