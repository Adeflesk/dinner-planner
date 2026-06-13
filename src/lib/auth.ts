export const SESSION_COOKIE = 'dp_session';

export async function sessionToken(): Promise<string> {
  const data = new TextEncoder().encode(`dinner-planner:${process.env.AUTH_SECRET}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function isValidSession(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  return token === (await sessionToken());
}
