'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db';
import { resolveWeekStart } from '@/lib/services/dates';
import { planWeek, swapDay, togglePin } from '@/lib/services/planning';

// Trust boundary: actions re-resolve the week from the raw form value, so the
// client can only ever act on the current or next week (see resolveWeekStart).
const weekFrom = (formData: FormData) => {
  const raw = formData.get('week');
  return {
    weekStart: resolveWeekStart(typeof raw === 'string' ? raw : undefined),
    isNext: raw === 'next',
  };
};

export async function planMyWeek(formData: FormData) {
  const { weekStart, isNext } = weekFrom(formData);
  const { aiDegraded } = await planWeek(getDb(), weekStart);
  revalidatePath('/');
  const wk = isNext ? '&week=next' : '';
  redirect(aiDegraded ? `/?degraded=1${wk}` : `/?planned=1${wk}`);
}

const SWAP_MODES = ['favourite', 'ai', 'ai-same-cuisine'] as const;
type SwapMode = typeof SWAP_MODES[number];

export async function swapDayAction(formData: FormData) {
  const day = Number(formData.get('day'));
  const raw = String(formData.get('mode'));
  if (!SWAP_MODES.includes(raw as SwapMode)) return;
  await swapDay(getDb(), weekFrom(formData).weekStart, day, raw as SwapMode);
  revalidatePath('/');
}

export async function togglePinAction(formData: FormData) {
  await togglePin(getDb(), weekFrom(formData).weekStart, Number(formData.get('day')));
  revalidatePath('/');
}
