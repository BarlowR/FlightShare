# Skylog

Turn a flight tracklog (IGC/GPX) and timestamped photos into an interactive 3D
playback over real terrain. This repo currently holds the **viewer** — an Astro
+ TypeScript single-page app that plays back a published flight bundle
(`flight.json` + media). See `skylog-design-doc.md` for the full product plan and
`FEATURES.md` for a map of viewer features to source files.

## Develop

```bash
npm install
npm run dev        # Astro dev server (Vite under the hood)
```

Then open the printed URL. On first load the viewer prompts for a **Cesium ion
access token** (free at https://ion.cesium.com/tokens) to stream terrain and
imagery. To skip the prompt, create a `.env`:

```
PUBLIC_CESIUM_ION_TOKEN=eyJhbGciOi...
# optional — which bundle to load (defaults to the demo)
PUBLIC_FLIGHT_URL=/flights/demo/flight.json
```

Build / preview the static site:

```bash
npm run build      # → dist/
npm run preview
npm run check      # astro + TypeScript check
```

## Pages

- `/` — **flight gallery**: auto-discovers every bundle under
  `public/flights/<slug>/flight.json` at build time and shows a card per flight.
  Drop in another bundle folder and it appears — no code change.
- `/view?flight=<slug>` — the **viewer**. `<slug>` picks the bundle
  (`/flights/<slug>/flight.json`); a full path also works. Falls back to
  `PUBLIC_FLIGHT_URL` / the demo.

## Layout

```
src/pages/index.astro     flight gallery (build-time discovery of public/flights/*)
src/pages/view.astro      viewer page shell (markup + CDN Cesium loader)
src/styles/global.css     styles + flight-visualization color vars (:root)
src/viewer/*.ts           the framework-light viewer modules (see FEATURES.md)
public/flights/<slug>/     a flight bundle: flight.json + media/{id}_web|_thumb.jpg
tracklog/                  raw source for the demo (IGC + original photos + thumbs)
flight-playback-demo.html  single-file reference / standalone-export seed (design §5.4)
```

The viewer loads CesiumJS from a CDN (ordered fallback), so it is **not** an npm
dependency and the app must be **served** (not opened via `file://`).
