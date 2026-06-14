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

const SWAP_MODES = ['favourite', 'ai', 'ai-same-cuisine'] as const;
type SwapMode = typeof SWAP_MODES[number];

export async function swapDayAction(formData: FormData) {
  const day = Number(formData.get('day'));
  const raw = String(formData.get('mode'));
  if (!SWAP_MODES.includes(raw as SwapMode)) return;
  await swapDay(getDb(), currentWeekStart(), day, raw as SwapMode);
  revalidatePath('/');
}

export async function togglePinAction(formData: FormData) {
  await togglePin(getDb(), currentWeekStart(), Number(formData.get('day')));
  revalidatePath('/');
}
