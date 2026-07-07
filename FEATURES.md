# Skylog viewer — features & source map

The viewer is a framework-light set of TypeScript modules under `src/viewer/`
that coordinate through one shared-state object (`state.ts`). It is a pure
consumer of a flight bundle (`flight.json` + `media/`), per the design doc §5.
This file catalogs what the viewer does and where each behavior lives.

## Structure

| File | Responsibility |
|---|---|
| `src/pages/index.astro` | Page shell: markup, fonts, the CDN Cesium loader (`is:inline`), imports `viewer/main`. |
| `src/styles/global.css` | All styling **and** the single source of truth for flight-viz colors (`:root` CSS vars). |
| `viewer/state.ts` | Shared mutable state `S` + the `TrackPoint` / `Photo` / `PhotoGroup` types. |
| `viewer/config.ts` | Tunable constants + env-driven config (ion token, flight URL, follow-cam, speed presets). |
| `viewer/colors.ts` | Reads the `:root` color vars into `C` for canvas/Cesium use. |
| `viewer/util.ts` | `$`, time formatting, `haversine`, `interpAt`, `rampColor`, the toast. |
| `viewer/markers.ts` | Photo-pin icon canvases: `circleThumb` (single) and `stackThumb` (multiphoto). |
| `viewer/bundle.ts` | `loadBundle`: fetch flight.json → track, photos, groups, stats, flight card. |
| `viewer/scene.ts` | `initCesium`: viewer, terrain sampling, track polyline, shadow, tethers, glider, photo pins, picking, initial framing. |
| `viewer/camera.ts` | Rubber-band follow cam, photo-panel pan offset, compass, Free/Follow toggle. |
| `viewer/playback.ts` | Clock tick + telemetry, altitude-profile scrubber, speed presets, `seek` / animated `scrubTo`. |
| `viewer/lightbox.ts` | The half-screen photo panel + co-located "group" strip. |
| `viewer/main.ts` | Wires the DOM controls and runs the token-gate → startup flow. |

## Features

- **Flight bundle** — loads `flight.json` (design §3.3); resolves each photo's
  `web`/`thumb` against the bundle base; preloads/decodes full-res photos so the
  lightbox switches instantly. (`bundle.ts`)
- **3D scene** — Cesium ion World Terrain; altitude-ramped opaque track polyline
  (cyan→magenta, scaled to max height), terrain-clamped ground shadow, vertical
  tether lines, a `SampledPositionProperty`-driven glider. Depth-tested against
  terrain. (`scene.ts`, `util.rampColor`)
- **Terrain diagnostics** — awaits terrain readiness with a timeout, validates
  samples, and toasts a named cause on failure (design §5.3). (`scene.ts`)
- **Playback chrome** — play/pause, live telemetry (alt/ground speed/vario),
  UTC + elapsed clock, and the altitude-profile canvas that doubles as the
  scrubber. (`playback.ts`)
- **Speed presets** — computed from flight length: the fastest replays the whole
  track in ~10 s (capped at 400×), others scale down; default plays in ~60 s.
  (`playback.buildSpeedControls`)
- **Follow camera** — zoomed-out, mostly-overhead, north-up default framing
  (~2/3 of the track); orbit-around-trackpoint drags; rubber-bands to the glider
  in real time whether playing or scrubbing. Free mode = normal globe controls.
  (`camera.ts`)
- **Compass** — small overlay whose red arrow points to true north as you orbit.
  (`camera.updateCompass`)
- **Photo pins** — magnifying-glass markers (circular thumbnail lens on a stem)
  anchored at the trackpoint; co-located photos collapse into a stacked
  multiphoto pin with a count; markers swell as playback passes. (`markers.ts`,
  `scene.ts`)
- **Photo panel** — half-screen, non-modal; the globe stays live and the camera
  pans so the subject sits in the free area. Prev/next + a group strip for
  co-located shots; opening/navigating sweeps the timeline with an ease-in-out.
  Closes when you scrub away. (`lightbox.ts`, `playback.scrubTo`, `camera.applyPanOffset`)
- **Flight card** — title/date/pilot/glider, headline stats, and a collapsible
  pilot description (More/Less). (`bundle.ts`)
- **Token gate** — prompts for a Cesium ion token unless `PUBLIC_CESIUM_ION_TOKEN`
  is set; ordered CDN load of CesiumJS with fallback. (`main.ts`, `index.astro`)

## Not yet implemented (see design doc)

Hosting/sharing API, Supabase, R2 uploads, accounts, video, and the automated
standalone-export build are future phases. `flight-playback-demo.html` remains
the single-file reference the export will mirror.
