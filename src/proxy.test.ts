import { describe, expect, it } from 'vitest';
import { config } from './proxy';

const matcherRegex = new RegExp('^' + config.matcher[0] + '$');

describe('proxy matcher', () => {
  it.each([
    '/manifest.webmanifest',
    '/icon.svg',
    '/icon-192.png',
    '/icon-512.png',
    '/icon-192-maskable.png',
    '/icon-512-maskable.png',
    '/apple-icon.png',
    '/login',
    '/_next/static/chunk.js',
  ])('does not proxy public path %s', (path) => {
    expect(matcherRegex.test(path)).toBe(false);
  });

  it.each(['/', '/shopping', '/family', '/recipes', '/recipes/abc-123'])(
    'proxies protected path %s',
    (path) => {
      expect(matcherRegex.test(path)).toBe(true);
    },
  );
});
