# PWA Install — Design Spec

**Date:** 2026-08-10
**Status:** Approved by user (brainstorming session)
**Roadmap item:** 7 (`docs/roadmap.md`)

## Problem

The app is used on a phone in a supermarket, but it lives in a browser tab
with browser chrome eating screen height and no home-screen presence. There
is no web app manifest, so no browser offers to install it.

Separately, `src/app/favicon.ico` is still the untouched create-next-app
default — the app currently ships the Next.js logo as its own icon.

## Decision

Make the app installable: a web app manifest, a real icon set drawn in the
app's existing palette, and the metadata iOS and Android need to open it in
a standalone window. Replace the scaffold favicon at the same time.

## Scope

**Manifest and icons only. No service worker.** With no network the
installed app shows the browser's offline error, exactly as the website does
today. Offline support was considered and deliberately deferred: the
shopping list is auth-gated and `force-dynamic`, so caching it usefully
raises stale-data and invalidation questions that belong in their own
feature.

## Non-Goals

- No service worker, no offline page, no cached data.
- No custom install-prompt UI (`beforeinstallprompt`). The browser's native
  install affordance is enough.
- No push notifications, no background sync.
- No `screenshots` manifest field (richer install dialogs). YAGNI.
- No custom iOS splash-screen artwork beyond what iOS derives from the
  icon and background colour.

## Artwork

One checked-in master at `public/icon.svg`, from which every raster size is
generated:

- Bottle-green `#1f4a38` rounded square, full bleed.
- A cream (`#f5f6f1`) capital **D**, drawn as **explicit vector paths, not
  a `font-family` reference.** Rasterising with sharp has no access to the
  Young Serif webfont, so a font reference would silently fall back to
  whatever the rendering machine has installed and produce different output
  for the next person who regenerates the set. Drawn paths render
  identically everywhere and let the stem weight be tuned to survive 48px.
  It reads as a serif; it is not literally Young Serif.
- A small dijon `#c79a2e` accent.

### Generated files

| File | Size | Referenced by |
| --- | --- | --- |
| `public/icon.svg` | — | nothing; authoring master only |
| `public/icon-192.png` | 192×192 | manifest, `purpose: 'any'` |
| `public/icon-512.png` | 512×512 | manifest, `purpose: 'any'` |
| `public/icon-192-maskable.png` | 192×192 | manifest, `purpose: 'maskable'` |
| `public/icon-512-maskable.png` | 512×512 | manifest, `purpose: 'maskable'` |
| `src/app/apple-icon.png` | 180×180 | Next file convention |
| `src/app/favicon.ico` | 16/32/48 | Next file convention |

The Apple icon lives in `src/app/`, **not** `public/`. Next's `apple-icon`
file convention emits `<link rel="apple-touch-icon">` automatically; a file
sitting in `public/` would need a hand-written link tag in the layout,
which is the kind of thing that silently rots. Same reasoning for
`favicon.ico`, which is already in `src/app/`.

Maskable variants are separate files rather than dual-purpose entries:
Android crops maskable icons to an adaptive shape, so the letter needs
padding that would look wrong wherever `purpose: 'any'` is used.

`apple-icon.png` must have **no alpha channel and no pre-rounded corners** —
iOS composites its own mask, and a transparent icon renders against black.

### Generation

PNGs are produced from the SVG with **sharp**, which resolves already as a
transitive dependency of Next (0.34.5 confirmed). This is a one-off
authoring step run by hand, not a build step and not a new project
dependency: the outputs are committed. The master SVG stays in the repo so
the set can be regenerated if the mark changes.

## Manifest

`src/app/manifest.ts` — Next's typed file convention. It is served at
`/manifest.webmanifest` and Next links it from every page automatically, so
no `<link rel="manifest">` is written by hand.

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

The four manifest icons are exactly the `public/` PNGs. The Apple icon and
the favicon are not listed here — Next's file conventions emit their link
tags, and duplicating them in the manifest would mean two places to keep in
step.

`start_url` is the **Plan page**, not the shopping list, even though the
in-store shopping flow is what motivates installing. Opening on the
shopping list would be wrong the other six days of the week, and the Plan
page already links prominently to it.

## Layout Metadata

In `src/app/layout.tsx`:

- Add an exported `viewport` carrying `themeColor: '#1f4a38'`. Next 16
  warns if `themeColor` is placed in `metadata`; it belongs in `viewport`.
- Add `appleWebApp: { capable: true, title: 'Dinners', statusBarStyle: 'default' }`
  to the existing `metadata` export, so iOS honours standalone mode when
  launched from the home screen.
- The existing `title` and `description` stay as they are.

## Testing

This is configuration and static assets. There is no logic to unit-test,
and a test asserting the manifest object matches a copy of itself would
assert nothing.

One test is worth writing, in `src/app/manifest.test.ts`:

- **Every icon path the manifest declares exists on disk and is non-empty.**
  This catches the real failure mode — an icon renamed, moved, or never
  committed, which silently breaks installation and is invisible in
  development. It reads `manifest()`, resolves each `src` against `public/`,
  and stats the file.

Beyond that: `npm run build` must pass, and installing on a real phone is a
manual check only the user can perform (see the plan's checklist).

## Housekeeping

Delete the five unused create-next-app SVGs from `public/`: `file.svg`,
`globe.svg`, `next.svg`, `vercel.svg`, `window.svg`. Nothing references
them; they are scaffold residue in the directory this feature works in.
