'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { pantryStaples, settings } from '@/lib/db/schema';
import { deletePersonById, upsertPerson, type PersonInput } from '@/lib/services/people';

const list = (v: FormDataEntryValue | null) =>
  String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

export async function savePerson(formData: FormData) {
  const input: PersonInput = {
    name: String(formData.get('name')),
    age: Number(formData.get('age')),
    sex: String(formData.get('sex')) as PersonInput['sex'],
    weightKg: Number(formData.get('weightKg')),
    heightCm: Number(formData.get('heightCm')),
    activity: String(formData.get('activity')) as PersonInput['activity'],
    goal: String(formData.get('goal')) as PersonInput['goal'],
    allergies: list(formData.get('allergies')),
    dislikes: list(formData.get('dislikes')),
  };
  const id = formData.get('id');
  await upsertPerson(getDb(), input, id ? String(id) : undefined);
  revalidatePath('/family');
}

export async function deletePerson(formData: FormData) {
  await deletePersonById(getDb(), String(formData.get('id')));
  revalidatePath('/family');
}

export async function saveSettings(formData: FormData) {
  const db = getDb();
  const values = {
    dinnerShare: Number(formData.get('dinnerShare')) / 100,
    cuisines: list(formData.get('cuisines')),
    equipment: formData.getAll('equipment').map(String),
    vegetarianNights: Number(formData.get('vegetarianNights')),
  };
  await db.insert(settings).values({ id: 1, ...values })
    .onConflictDoUpdate({ target: settings.id, set: values });
  revalidatePath('/family');
}

export async function addStaple(formData: FormData) {
  const name = String(formData.get('name')).trim();
  if (name) await getDb().insert(pantryStaples).values({ name }).onConflictDoNothing();
  revalidatePath('/family');
}

export async function removeStaple(formData: FormData) {
  await getDb().delete(pantryStaples).where(eq(pantryStaples.id, String(formData.get('id'))));
  revalidatePath('/family');
}
