'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db';
import { currentWeekStart } from '@/lib/services/dates';
import { planWeek, swapDay, togglePin } from '@/lib/services/planning';

export async function planMyWeek() {
  const { aiDegraded } = await planWeek(getDb(), currentWeekStart());
  revalidatePath('/');
  if (aiDegraded) redirect('/?degraded=1');
}

export async function swapDayAction(formData: FormData) {
  const day = Number(formData.get('day'));
  const mode = String(formData.get('mode')) as 'favourite' | 'ai' | 'ai-same-cuisine';
  await swapDay(getDb(), currentWeekStart(), day, mode);
  revalidatePath('/');
}

export async function togglePinAction(formData: FormData) {
  await togglePin(getDb(), currentWeekStart(), Number(formData.get('day')));
  revalidatePath('/');
}
