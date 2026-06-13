import { NextResponse, type NextRequest } from 'next/server';
import { isValidSession, SESSION_COOKIE } from '@/lib/auth';

export async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (await isValidSession(token)) return NextResponse.next();
  return NextResponse.redirect(new URL('/login', request.url));
}

export const config = {
  matcher: ['/((?!login|_next|favicon.ico|.*\\.png$).*)'],
};
