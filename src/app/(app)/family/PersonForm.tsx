import { people } from '@/lib/db/schema';
import { savePerson } from '@/app/actions/family';

type Person = typeof people.$inferSelect;

export function PersonForm({ person }: { person?: Person }) {
  return (
    <form action={savePerson} className="grid grid-cols-2 gap-2 text-sm">
      {person && <input type="hidden" name="id" value={person.id} />}
      <input name="name" placeholder="Name" required defaultValue={person?.name} className="rounded border p-2" />
      <input name="age" type="number" placeholder="Age" required defaultValue={person?.age} className="rounded border p-2" />
      <select name="sex" defaultValue={person?.sex} className="rounded border p-2">
        <option value="male">male</option><option value="female">female</option>
      </select>
      <input name="weightKg" type="number" step="0.5" placeholder="Weight (kg)" required defaultValue={person?.weightKg} className="rounded border p-2" />
      <input name="heightCm" type="number" placeholder="Height (cm)" required defaultValue={person?.heightCm} className="rounded border p-2" />
      <select name="activity" defaultValue={person?.activity} className="rounded border p-2">
        <option value="sedentary">sedentary</option><option value="light">light</option>
        <option value="moderate">moderate</option><option value="active">active</option>
        <option value="very_active">very active</option>
      </select>
      <select name="goal" defaultValue={person?.goal} className="rounded border p-2">
        <option value="maintain">maintain</option><option value="lose">lose</option><option value="gain">gain</option>
      </select>
      <input name="allergies" placeholder="Allergies (comma-separated)" defaultValue={person?.allergies.join(', ')} className="rounded border p-2" />
      <input name="dislikes" placeholder="Dislikes (comma-separated)" defaultValue={person?.dislikes.join(', ')} className="rounded border p-2" />
      <button className="col-span-2 rounded bg-emerald-700 p-2 text-white">{person ? 'Save changes' : 'Save person'}</button>
    </form>
  );
}
