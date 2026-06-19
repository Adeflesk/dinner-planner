import { describe, expect, it } from 'vitest';
import { createTestDb } from '@/lib/test/db';
import { people } from '@/lib/db/schema';
import { deletePersonById, upsertPerson, type PersonInput } from './people';

const sample: PersonInput = {
  name: 'Alice', age: 42, sex: 'female',
  weightKg: 70, heightCm: 168, activity: 'moderate', goal: 'maintain',
  allergies: ['peanuts'], dislikes: ['olives'],
};

describe('upsertPerson', () => {
  it('inserts a new person when no id is given', async () => {
    const db = await createTestDb();
    await upsertPerson(db, sample);
    const rows = await db.select().from(people);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'Alice', weightKg: 70, goal: 'maintain' });
    expect(rows[0].allergies).toEqual(['peanuts']);
  });

  it('updates the existing row in place when an id is given', async () => {
    const db = await createTestDb();
    await upsertPerson(db, sample);
    const [created] = await db.select().from(people);
    await upsertPerson(db, { ...sample, weightKg: 75, goal: 'lose' }, created.id);
    const rows = await db.select().from(people);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(created.id);
    expect(rows[0].weightKg).toBe(75);
    expect(rows[0].goal).toBe('lose');
  });

  it('round-trips array fields through jsonb', async () => {
    const db = await createTestDb();
    await upsertPerson(db, { ...sample, allergies: ['gluten', 'shellfish'], dislikes: [] });
    const [row] = await db.select().from(people);
    expect(row.allergies).toEqual(['gluten', 'shellfish']);
    expect(row.dislikes).toEqual([]);
  });

  it('silently no-ops when updating a non-existent id', async () => {
    const db = await createTestDb();
    const nonExistentId = '00000000-0000-0000-0000-000000000000';
    await upsertPerson(db, sample, nonExistentId);
    const rows = await db.select().from(people);
    expect(rows).toHaveLength(0);
  });
});

describe('deletePersonById', () => {
  it('removes the row', async () => {
    const db = await createTestDb();
    await upsertPerson(db, sample);
    const [row] = await db.select().from(people);
    await deletePersonById(db, row.id);
    expect(await db.select().from(people)).toHaveLength(0);
  });
});
