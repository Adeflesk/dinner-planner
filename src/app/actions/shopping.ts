'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db';
import { resolveWeekStart } from '@/lib/services/dates';
import {
  addItem, buildList, decodeStapleUndo, encodeStapleUndo, markItemStaple,
  removeItem, toggleItem, undoMarkStaple,
} from '@/lib/services/shopping';

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

export async function markStapleAction(formData: FormData) {
  const isNext = formData.get('week') === 'next';
  const item = await markItemStaple(getDb(), String(formData.get('listId')), Number(formData.get('index')));
  revalidatePath('/shopping');
  const params = new URLSearchParams(isNext ? { week: 'next' } : {});
  if (item) params.set('undo', encodeStapleUndo({ name: item.name, item }));
  redirect(`/shopping${params.size ? `?${params}` : ''}`);
}

export async function undoStapleAction(formData: FormData) {
  const undo = decodeStapleUndo(String(formData.get('undo') ?? ''));
  if (undo) await undoMarkStaple(getDb(), String(formData.get('listId')), undo.name, undo.item);
  revalidatePath('/shopping');
  redirect(formData.get('week') === 'next' ? '/shopping?week=next' : '/shopping');
}
