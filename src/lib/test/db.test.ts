import { describe, expect, it } from 'vitest';
import { people } from '@/lib/db/schema';
import { createTestDb } from './db';

describe('createTestDb', () => {
  it('applies migrations so tables are queryable and empty', async () => {
    const db = await createTestDb();
    expect(await db.select().from(people)).toEqual([]);
  });

  it('returns an isolated database each call', async () => {
    const a = await createTestDb();
    const b = await createTestDb();
    await a.insert(people).values({
      name: 'Solo', age: 30, sex: 'male', weightKg: 80, heightCm: 180,
      activity: 'moderate', goal: 'maintain', allergies: [], dislikes: [],
    });
    expect(await a.select().from(people)).toHaveLength(1);
    expect(await b.select().from(people)).toHaveLength(0);
  });
});
