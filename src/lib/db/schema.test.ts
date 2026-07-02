import { describe, expect, it } from 'vitest';
import { createTestDb } from '@/lib/test/db';
import { recipes, settings } from '@/lib/db/schema';

describe('equipment columns', () => {
  it('defaults recipes.equipment to an empty array', async () => {
    const db = await createTestDb();
    const [row] = await db.insert(recipes).values({
      name: 'Plain bake', perServing: { kcal: 500, protein: 30, carbs: 50, fat: 18 },
      ingredients: [{ name: 'potato', quantity: 4, unit: 'pcs', section: 'produce' }],
    }).returning();
    expect(row.equipment).toEqual([]);
  });

  it('round-trips recipes.equipment through jsonb', async () => {
    const db = await createTestDb();
    const [row] = await db.insert(recipes).values({
      name: 'Steamed fish', perServing: { kcal: 400, protein: 35, carbs: 20, fat: 18 },
      equipment: ['steam', 'combi-steam'],
      ingredients: [{ name: 'salmon', quantity: 500, unit: 'g', section: 'meat_fish' }],
    }).returning();
    expect(row.equipment).toEqual(['steam', 'combi-steam']);
  });

  it('defaults settings.equipment to an empty array', async () => {
    const db = await createTestDb();
    await db.insert(settings).values({ id: 1 });
    const [row] = await db.select().from(settings);
    expect(row.equipment).toEqual([]);
  });
});
