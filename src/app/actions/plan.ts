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
  const { aiDegraded, gaps } = await planWeek(getDb(), weekStart);
  revalidatePath('/');
  const wk = isNext ? '&week=next' : '';
  const shortfall = gaps > 0 ? `&gaps=${gaps}` : '';
  redirect(aiDegraded ? `/?degraded=1${wk}${shortfall}` : `/?planned=1${wk}${shortfall}`);
}

const SWAP_MODES = ['favourite', 'ai', 'ai-same-cuisine'] as const;
type SwapMode = typeof SWAP_MODES[number];

// A non-UUID id would make the uuid-typed query throw; treat it as a no-op instead.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function swapDayAction(formData: FormData) {
  const day = Number(formData.get('day'));
  const raw = String(formData.get('mode'));
  const { weekStart, isNext } = weekFrom(formData);

  // Manual pick: route to swapDay's explicit-recipe mode, then redirect so the
  // ?pick= / ?q= params drop and the picker panel closes.
  if (raw === 'pick') {
    const recipeId = String(formData.get('recipeId'));
    if (!UUID_RE.test(recipeId)) return; // malformed id — return without changes
    const { ok } = await swapDay(getDb(), weekStart, day, { recipeId });
    revalidatePath('/');
    const params = new URLSearchParams();
    if (isNext) params.set('week', 'next');
    if (!ok) params.set('error', 'gone'); // deleted between render and submit
    const qs = params.toString();
    redirect(qs ? `/?${qs}` : '/');
  }

  if (!SWAP_MODES.includes(raw as SwapMode)) return;
  await swapDay(getDb(), weekStart, day, raw as SwapMode);
  revalidatePath('/');
}

export async function togglePinAction(formData: FormData) {
  await togglePin(getDb(), weekFrom(formData).weekStart, Number(formData.get('day')));
  revalidatePath('/');
}
