import { statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import manifest from './manifest';

describe('manifest', () => {
  it('declares the identity the install dialog shows', () => {
    const m = manifest();
    expect(m.name).toBe('Dinner Planner');
    expect(m.short_name).toBe('Dinners');
    expect(m.start_url).toBe('/');
    expect(m.display).toBe('standalone');
    expect(m.theme_color).toBe('#1f4a38');
  });

  it('points every icon at a file that exists and is not empty', () => {
    const icons = manifest().icons ?? [];
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) {
      const path = join(process.cwd(), 'public', icon.src);
      expect(statSync(path).size, `${icon.src} is empty or missing`).toBeGreaterThan(0);
    }
  });

  it('offers both a plain and a maskable icon at each size', () => {
    const icons = manifest().icons ?? [];
    const purposes = (size: string) =>
      icons.filter((i) => i.sizes === size).map((i) => i.purpose).sort();
    expect(purposes('192x192')).toEqual(['any', 'maskable']);
    expect(purposes('512x512')).toEqual(['any', 'maskable']);
  });

  // These two are wired by Next's file conventions rather than the manifest, so
  // nothing else in the suite would notice if they were deleted or renamed.
  it('keeps the icon files Next links by convention', () => {
    for (const file of ['icon.svg', 'apple-icon.png']) {
      const path = join(process.cwd(), 'src', 'app', file);
      expect(statSync(path).size, `${file} is empty or missing`).toBeGreaterThan(0);
    }
  });
});
