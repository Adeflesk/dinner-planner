'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db';
import { resolveWeekStart } from '@/lib/services/dates';
import { addItem, buildList, removeItem, toggleItem } from '@/lib/services/shopping';

export async function buildListAction(formData: FormData) {
  const low = formData.getAll('lowStaple').map(String);
  const raw = formData.get('week');
  await buildList(getDb(), resolveWeekStart(typeof raw === 'string' ? raw : undefined), low);
  revalidatePath('/shopping');
}

export async function toggleItemAction(formData: FormData) {
  await toggleItem(getDb(), String(formData.get('listId')), Number(formData.get('index')));
  revalidatePath('/shopping');
}

export async function addItemAction(formData: FormData) {
  const name = String(formData.get('name')).trim();
  if (name) await addItem(getDb(), String(formData.get('listId')), name);
  revalidatePath('/shopping');
}

export async function removeItemAction(formData: FormData) {
  await removeItem(getDb(), String(formData.get('listId')), Number(formData.get('index')));
  revalidatePath('/shopping');
}
