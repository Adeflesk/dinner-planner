'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, sessionToken } from '@/lib/auth';

export async function login(formData: FormData) {
  const password = formData.get('password');
  if (password !== process.env.HOUSEHOLD_PASSWORD) {
    redirect('/login?error=1');
  }
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, await sessionToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
  });
  redirect('/');
}
