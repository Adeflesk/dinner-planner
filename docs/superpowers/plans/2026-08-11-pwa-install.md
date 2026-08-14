# PWA Install Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dinner planner installable to a phone home screen, opening in its own standalone window with a real icon instead of the Next.js logo.

**Architecture:** One hand-authored SVG is the single source of truth for every icon. A throwaway script rasterises it into the four manifest PNGs and the Apple touch icon using sharp (already present transitively via Next), and the outputs are committed — no build step, no new dependency. `src/app/manifest.ts` and Next's `icon`/`apple-icon` file conventions wire everything into the HTML automatically.

**Tech Stack:** Next.js 16 App Router (`manifest.ts`, `icon.svg`, `apple-icon.png` file conventions), sharp 0.34.5 (authoring-time only), Vitest.

**Spec:** `docs/superpowers/specs/2026-08-10-pwa-install-design.md`

## Global Constraints

- **Palette, exact values:** bottle green `#1f4a38`, dijon `#c79a2e`, porcelain `#f5f6f1`, ink `#26281f`. These are the real tokens from `src/app/globals.css` — do not invent shades.
- **Manifest identity, exact strings:** `name: 'Dinner Planner'`, `short_name: 'Dinners'`, `description: 'Weekly family dinner planner with macro targets'`, `start_url: '/'`, `display: 'standalone'`, `background_color: '#f5f6f1'`, `theme_color: '#1f4a38'`.
- **The "D" is drawn as vector paths, never a `font-family` reference.** Rasterising has no access to the Young Serif webfont; a font reference would fall back to whatever the machine has and render differently on regeneration.
- **`apple-icon.png` must be fully opaque with square corners** — iOS composites its own mask, and a transparent icon renders against black.
- **No service worker, no offline caching, no install-prompt UI, no push.** Out of scope by decision.
- **No new entries in `package.json`.** sharp is used at authoring time only, resolved from the existing tree.
- **There is no `favicon.ico`** — it is deleted, not replaced. sharp cannot write `.ico`.
- Run the full suite with `npm test`; a single file with `npx vitest run <path>`; typecheck with `npx tsc --noEmit`; build with `npm run build`.

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `src/app/icon.svg` | The mark. Browser icon via Next convention, and the master every PNG is generated from | Create |
| `src/app/apple-icon.png` | 180×180 opaque iOS touch icon | Create (generated) |
| `public/icon-192.png` | Manifest icon, `purpose: 'any'` | Create (generated) |
| `public/icon-512.png` | Manifest icon, `purpose: 'any'` | Create (generated) |
| `public/icon-192-maskable.png` | Manifest icon, `purpose: 'maskable'`, padded | Create (generated) |
| `public/icon-512-maskable.png` | Manifest icon, `purpose: 'maskable'`, padded | Create (generated) |
| `src/app/manifest.ts` | The web app manifest | Create |
| `src/app/manifest.test.ts` | Asserts every declared icon exists on disk | Create |
| `src/app/layout.tsx` | `viewport` theme colour + `appleWebApp` metadata | Modify |
| `src/app/favicon.ico` | Scaffold Next.js logo | Delete |
| `public/*.svg` (5 files) | create-next-app residue | Delete |

---

### Task 1: The icon artwork

**Files:**
- Create: `src/app/icon.svg`
- Delete: `src/app/favicon.ico`

**Interfaces:**
- Produces: `src/app/icon.svg` — a 512×512 `viewBox="0 0 512 512"` SVG. Task 2 rasterises exactly this file; Next serves it as the browser icon.

Icon design cannot be verified by a test — it has to be looked at. This
task ends with rendering a preview and inspecting it.

- [ ] **Step 1: Write the SVG**

Create `src/app/icon.svg`. The background is a full-bleed rounded square;
the D is built from an outer contour plus a counter, closed with
`fill-rule="evenodd"` so the counter punches through. The stem carries
slab serifs top and bottom, which is what makes it read as a serif rather
than a geometric letter.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" rx="112" fill="#1f4a38"/>
  <path fill="#f5f6f1" fill-rule="evenodd" d="
    M 150 136
    L 272 136
    C 350 136, 400 190, 400 256
    C 400 322, 350 376, 272 376
    L 150 376
    L 150 344
    L 196 344
    L 196 168
    L 150 168
    Z
    M 244 168
    L 244 344
    L 272 344
    C 328 344, 358 308, 358 256
    C 358 204, 328 168, 272 168
    Z
  "/>
  <rect x="150" y="404" width="212" height="20" rx="10" fill="#c79a2e"/>
</svg>
```

- [ ] **Step 2: Render a preview and look at it**

```bash
node -e "
const sharp = require('sharp');
sharp('src/app/icon.svg').resize(512, 512).png().toFile('/tmp/icon-preview-512.png')
  .then(() => sharp('src/app/icon.svg').resize(48, 48).png().toFile('/tmp/icon-preview-48.png'))
  .then(() => console.log('wrote /tmp/icon-preview-512.png and /tmp/icon-preview-48.png'));
"
```

Then **read both PNGs as images** and judge them:

- At 512 the D must be a clean letterform — stem and bowl joined, counter
  fully punched through, no stray fill from a mis-signed path.
- At 48 the D must still be unmistakably a D, and the dijon bar must not
  have smeared into a grey line. If either fails, the stem is too light or
  the bar too thin — thicken and re-render.

Iterate on the path data until both look right. This is the whole point of
the task; do not proceed on an icon you have not viewed.

- [ ] **Step 3: Delete the scaffold favicon**

```bash
git rm src/app/favicon.ico
```

Do not create a replacement `.ico`. Next links `icon.svg` automatically,
and sharp cannot write the `.ico` format.

- [ ] **Step 4: Confirm the app still builds and serves an icon link**

```bash
npm run build
```

Expected: build succeeds. (The generated `<link rel="icon">` is verified by
eye in Task 4's manual check; the build is what proves the file convention
is wired.)

- [ ] **Step 5: Commit**

```bash
git add src/app/icon.svg
git commit -m "feat: draw the dinner planner mark, replacing the Next.js favicon"
```

---

### Task 2: Generate the raster icon set

**Files:**
- Create: `src/app/apple-icon.png`, `public/icon-192.png`, `public/icon-512.png`, `public/icon-192-maskable.png`, `public/icon-512-maskable.png`
- Delete: `public/file.svg`, `public/globe.svg`, `public/next.svg`, `public/vercel.svg`, `public/window.svg`

**Interfaces:**
- Consumes: `src/app/icon.svg` from Task 1.
- Produces: the five PNG paths above. Task 3's manifest references the four in `public/` by exactly these names.

- [ ] **Step 1: Generate the five PNGs**

Run this once. It is an authoring step, not a build step — nothing in the
repo will reference the script, so it does not get committed.

```bash
node -e "
const sharp = require('sharp');
const svg = 'src/app/icon.svg';
const GREEN = '#1f4a38';

const plain = (size, out) =>
  sharp(svg).resize(size, size).png().toFile(out).then(() => console.log('wrote', out));

// Android crops maskable icons to an adaptive shape, so inset the mark to ~80%
// and fill the freed border with the same green: the crop then never bites the letter.
const maskable = (size, out) => {
  const inner = Math.round(size * 0.8);
  const pad = Math.round((size - inner) / 2);
  return sharp(svg).resize(inner, inner).png().toBuffer()
    .then((buf) => sharp({ create: { width: size, height: size, channels: 4, background: GREEN } })
      .composite([{ input: buf, top: pad, left: pad }])
      .png().toFile(out))
    .then(() => console.log('wrote', out));
};

// iOS applies its own mask and renders alpha against black, so flatten to opaque.
const apple = (size, out) =>
  sharp(svg).resize(size, size).flatten({ background: GREEN }).png().toFile(out)
    .then(() => console.log('wrote', out));

Promise.all([
  plain(192, 'public/icon-192.png'),
  plain(512, 'public/icon-512.png'),
  maskable(192, 'public/icon-192-maskable.png'),
  maskable(512, 'public/icon-512-maskable.png'),
  apple(180, 'src/app/apple-icon.png'),
]).catch((e) => { console.error(e); process.exit(1); });
"
```

- [ ] **Step 2: Verify the outputs mechanically**

```bash
node -e "
const sharp = require('sharp');
const files = [
  ['public/icon-192.png', 192], ['public/icon-512.png', 512],
  ['public/icon-192-maskable.png', 192], ['public/icon-512-maskable.png', 512],
  ['src/app/apple-icon.png', 180],
];
Promise.all(files.map(([f, size]) => sharp(f).metadata().then((m) => {
  const ok = m.width === size && m.height === size;
  const opaqueRequired = f.endsWith('apple-icon.png');
  const alphaOk = !opaqueRequired || !m.hasAlpha;
  console.log(f, m.width + 'x' + m.height, 'alpha=' + m.hasAlpha, ok && alphaOk ? 'OK' : 'FAIL');
  if (!ok || !alphaOk) process.exitCode = 1;
})));
"
```

Expected: five `OK` lines. `apple-icon.png` must report `alpha=false`; the
others may report either.

- [ ] **Step 3: Look at the maskable and Apple icons**

Read `public/icon-512-maskable.png` and `src/app/apple-icon.png` as images.
Confirm the maskable one has visible green breathing room around the mark
(so an aggressive circular crop still misses the letter) and that the Apple
one has hard square corners with no transparency showing as black.

- [ ] **Step 4: Delete the create-next-app residue**

Confirm nothing references them, then remove:

```bash
grep -rn "file.svg\|globe.svg\|next.svg\|vercel.svg\|window.svg" src/ || echo "no references"
git rm public/file.svg public/globe.svg public/next.svg public/vercel.svg public/window.svg
```

Expected: `no references`, then the five files staged for deletion. If any
reference exists, stop and report it rather than deleting.

- [ ] **Step 5: Commit**

```bash
git add public/icon-192.png public/icon-512.png public/icon-192-maskable.png public/icon-512-maskable.png src/app/apple-icon.png
git commit -m "feat: generate the icon set and drop the scaffold SVGs"
```

---

### Task 3: Manifest and layout metadata

**Files:**
- Create: `src/app/manifest.ts`, `src/app/manifest.test.ts`
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Consumes: the four `public/` PNGs from Task 2, by exact filename.
- Produces: `export default function manifest(): MetadataRoute.Manifest` in `src/app/manifest.ts`, served by Next at `/manifest.webmanifest`.

- [ ] **Step 1: Write the failing test**

Create `src/app/manifest.test.ts`. This asserts the one thing that can
actually break silently: an icon the manifest promises but the repo does
not contain. It resolves each `src` against `public/` and stats it.

```ts
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
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/manifest.test.ts`
Expected: FAIL — `./manifest` does not exist.

- [ ] **Step 3: Write the manifest**

Create `src/app/manifest.ts`:

```ts
import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Dinner Planner',
    short_name: 'Dinners',
    description: 'Weekly family dinner planner with macro targets',
    start_url: '/',
    display: 'standalone',
    background_color: '#f5f6f1',
    theme_color: '#1f4a38',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-192-maskable.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/app/manifest.test.ts`
Expected: PASS, all three cases.

- [ ] **Step 5: Add the viewport and Apple metadata**

In `src/app/layout.tsx`, extend the type import and the existing `metadata`
export, and add a new `viewport` export beside it. `themeColor` belongs in
`viewport`, not `metadata` — Next 16 warns if it is placed in the latter.

Change the first import line to:

```tsx
import type { Metadata, Viewport } from "next";
```

Replace the existing `metadata` export with:

```tsx
export const metadata: Metadata = {
  title: "Dinner Planner",
  description: "Weekly family dinner planner with macro targets",
  appleWebApp: { capable: true, title: "Dinners", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#1f4a38",
};
```

Leave the font setup, the `html`/`body` markup, and their classes untouched.

- [ ] **Step 6: Run the full suite, typecheck and build**

```bash
npm test && npx tsc --noEmit && npm run build
```

Expected: all tests pass, no type errors, build succeeds. The build output
must not warn about `themeColor` being in `metadata` — if it does, Step 5
was applied to the wrong export.

- [ ] **Step 7: Confirm the manifest and icon links are actually emitted**

```bash
npm run build > /dev/null 2>&1 && grep -rl "manifest.webmanifest" .next/server/app/ | head -3
```

Expected: at least one match, proving Next linked the manifest into the
rendered HTML rather than merely compiling the file.

- [ ] **Step 8: Commit**

```bash
git add src/app/manifest.ts src/app/manifest.test.ts src/app/layout.tsx
git commit -m "feat: web app manifest, theme colour and iOS standalone metadata"
```

---

### Task 4: Manual install check

**Files:** none — this task changes nothing.

This is the only way to confirm the feature works; everything above proves
the files exist and are wired, not that a phone accepts them. It needs a
deployed preview, so it happens after the PR is raised.

- [ ] **Step 1: Verify on a deployed preview URL**

On an **Android/Chrome** phone:

1. Open the preview URL. Chrome's menu offers "Install app" / "Add to Home screen".
2. Install it. The home-screen icon is the green D — not a screenshot of the page, and not a letter in a white circle (that means the maskable icons are missing or wrongly named).
3. Launch it. It opens with no browser address bar, and the status bar is bottle green.

On an **iPhone/Safari**:

4. Share → "Add to Home Screen". The suggested name is "Dinners" and the preview icon is the green D on a square, with no black corners.
5. Launch it. It opens standalone, with no Safari chrome.
6. Confirm you are still logged in — the session cookie is 30 days, so it should not ask for the household password again.

If the Android icon appears inside a white circle, the maskable PNGs are
not being picked up; re-check their filenames against `manifest.ts`.

---

## Self-Review

**Spec coverage**

| Spec requirement | Task |
| --- | --- |
| Drawn vector "D", no font reference | 1 (Step 1) |
| Bottle-green ground, cream letter, dijon accent | 1 (Step 1) |
| Scaffold `favicon.ico` deleted, no `.ico` replacement | 1 (Step 3) |
| `src/app/icon.svg` is both browser icon and master | 1 (Step 1), consumed in 2 |
| `icon-192/512.png`, `purpose: 'any'` | 2 (Step 1), 3 (Step 3) |
| Maskable variants with ~10% safe padding | 2 (Step 1, 80% inset = 10% each side) |
| `apple-icon.png` 180×180, opaque, square corners | 2 (Steps 1–3) |
| Generated with sharp, no new dependency | 2 (Step 1, `node -e`, nothing committed) |
| Manifest exact strings and `start_url: '/'` | 3 (Step 3), asserted in Step 1's test |
| `themeColor` in `viewport`, not `metadata` | 3 (Step 5), guarded by Step 6 |
| `appleWebApp` for iOS standalone | 3 (Step 5) |
| Test: every declared icon exists and is non-empty | 3 (Step 1) |
| Delete five create-next-app SVGs | 2 (Step 4) |
| No service worker / offline / prompt UI / push | absent from every task by construction |
| Manual install check | 4 |

**Placeholder scan:** none — every step carries literal SVG, code, or a
runnable command.

**Type consistency:** the four `public/` filenames in Task 2 Step 1 match
the four `src` values in Task 3 Step 3 exactly, and Task 3's test derives
its paths from the manifest rather than repeating them, so a rename breaks
the test rather than passing silently. `manifest()` is the default export
in both the test's import and the implementation.

**Known risk, accepted:** the SVG path data in Task 1 is written blind and
may need adjusting once rendered — which is exactly why Step 2 renders and
inspects it before anything downstream consumes it.
