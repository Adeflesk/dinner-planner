import { eq } from 'drizzle-orm';
import type { Db } from '@/lib/db';
import { people } from '@/lib/db/schema';

export type PersonInput = {
  name: string;
  age: number;
  sex: 'male' | 'female';
  weightKg: number;
  heightCm: number;
  activity: 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
  goal: 'lose' | 'maintain' | 'gain';
  allergies: string[];
  dislikes: string[];
};

// id present → update that person; id absent → insert a new one.
// If id is given but not found in the table (e.g. concurrent deletion), silently no-op—not an error.
export async function upsertPerson(db: Db, input: PersonInput, id?: string): Promise<void> {
  if (id) await db.update(people).set(input).where(eq(people.id, id));
  else await db.insert(people).values(input);
}

export async function deletePersonById(db: Db, id: string): Promise<void> {
  await db.delete(people).where(eq(people.id, id));
}
