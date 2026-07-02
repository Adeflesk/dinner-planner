import { beforeEach, describe, expect, it } from 'vitest';
import { sessionToken, isValidSession, SESSION_COOKIE } from './auth';

describe('auth', () => {
  beforeEach(() => { process.env.AUTH_SECRET = 'test-secret'; });

  it('produces a deterministic token from AUTH_SECRET', async () => {
    expect(await sessionToken()).toBe(await sessionToken());
    expect(await sessionToken()).toMatch(/^[0-9a-f]{64}$/);
  });
  it('changes with the secret', async () => {
    const a = await sessionToken();
    process.env.AUTH_SECRET = 'other-secret';
    expect(await sessionToken()).not.toBe(a);
  });
  it('validates only the correct token', async () => {
    expect(await isValidSession(await sessionToken())).toBe(true);
    expect(await isValidSession('nope')).toBe(false);
    expect(await isValidSession(undefined)).toBe(false);
  });
  it('exports a cookie name', () => {
    expect(SESSION_COOKIE).toBe('dp_session');
  });
});
