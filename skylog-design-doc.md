# Skylog — Design Document & Development Plan

**Version 0.1 · July 2026 · Status: Draft for review**

---

## 1. Overview

Skylog is a web application that turns a flight tracklog (IGC or GPX) and a set of timestamped photos into an interactive 3D playback: the flight replays over real terrain, and photos appear as clickable markers at the position on the track where they were taken. Flights are hosted and shareable by link, with a standalone single-file HTML export as an offline/archival option.

The initial audience is free-flight pilots (paragliding, hang gliding, sailplanes), who record every flight as an IGC file and routinely share flights in group chats. The product must launch simple but be architected from day one for three planned extensions: video media, user accounts, and a paid subscription tier.

### 1.1 Goals

The v1 product lets a visitor upload a tracklog and photos, synchronize photo timestamps to the track, preview the 3D playback, and publish it to a share link that anyone can open — no account required to create or to view. All heavy processing (parsing, EXIF reading, image downscaling) happens in the browser; the backend stores only processed, privacy-scrubbed artifacts.

### 1.2 Non-goals (v1)

Live tracking, social features (comments, likes, feeds), flight scoring/XC leagues, mobile native apps, and multi-flight comparison are out of scope for v1. Video upload is out of scope for v1 but explicitly designed for (Section 7). Nothing in the v1 architecture may foreclose these.

### 1.3 Success criteria

A pilot can go from files to a shareable link in under two minutes on a mid-range laptop; a shared link renders the flight in under five seconds on a typical connection; per-flight storage cost stays in single-digit megabytes; and adding accounts or billing later requires no schema migration of existing flight data.

---

## 2. Product requirements

### 2.1 Functional requirements

**Ingest.** Accept IGC and GPX tracklogs via drag-and-drop or file picker. Accept JPEG/PNG/HEIC photos in the same drop. Parse tracklogs into a normalized time series of latitude, longitude, and altitude. Read photo capture time (`DateTimeOriginal`) and, when present, GPS coordinates from EXIF.

**Time synchronization.** IGC times are UTC; camera EXIF is usually local time with no zone marker, and camera clocks drift. The app must therefore offer an automatic offset guess (when a photo carries GPS EXIF, solve for the time offset that places it closest to the track) and a manual offset control with live visual feedback — photo dots sliding along the track as the offset changes. Each photo's position is interpolated between the two nearest track fixes.

**Playback.** 3D globe with real terrain and imagery; the track drawn as a polyline color-graded by altitude; an animated marker driven by the flight clock; play/pause, speed multipliers, and scrubbing; free-orbit and follow camera modes; live telemetry (altitude, groundspeed, climb rate).

**Photos in the scene.** Each photo renders as a clickable dot at its interpolated position, always visible and pickable. Clicking opens a lightbox with the full photo, caption, capture time, altitude, and previous/next navigation. Dots pulse as playback passes their timestamp. The altitude-profile scrubber also shows photo markers, clickable there as well.

**Publishing.** One click produces a share link (`/f/{slug}`) and a secret manage link for later edit/delete. Uploads are unlisted by default: anyone with the link can view, nobody can discover it.

**Export.** A "download as single file" option produces one self-contained HTML file with the viewer code, track JSON, and downscaled photos embedded as base64.

### 2.2 Extensibility requirements

The data model, storage layout, and viewer format must accommodate, without migration of existing data: video media occupying a time *range* rather than an instant, with an asynchronous processing state; user accounts with ownership of previously anonymous flights; and plan-based entitlements enforced at every upload path.

---

## 3. System architecture

### 3.1 Shape

A static single-page frontend, a thin API, object storage for media, and Postgres for metadata. All file processing runs client-side; the server never parses a tracklog or touches photo bytes beyond storing them.

```
Browser (parse IGC/GPX, EXIF, downscale, sync UI, Cesium viewer)
   │  signed uploads (media, flight.json)
   ▼
Cloudflare R2  ◄──────────  Viewer fetches flight bundle by slug
   ▲
   │  upload slots, publish/confirm, manage, claim
Thin API (Supabase Edge Functions or CF Workers)
   │
   ▼
Supabase Postgres (+ Auth, Row Level Security)
```

### 3.2 Component choices and rationale

**Frontend:** Astro + TypeScript SPA (Astro builds on Vite, so the dev server, HMR, and esbuild-based TS transpile come for free, while Astro gives a clean static page shell and zero-JS-by-default output). No UI framework (React/etc.): the viewer is deliberately framework-light — a set of plain TypeScript modules that coordinate through one shared-state object — so it can be reused verbatim in the standalone export. Concretely: the viewer page is `src/pages/index.astro` (markup + the CDN Cesium loader), and the viewer logic lives in `src/viewer/*.ts` (state, config, colors, util, markers, camera, playback, lightbox, scene, bundle, main). CesiumJS is loaded from a CDN with an ordered fallback (§5.3) rather than bundled, keeping the standalone export portable.

**Rendering engine:** CesiumJS, Apache-2.0 licensed and free for commercial use. It provides the 3D globe, terrain, time-dynamic entities, and clock — flight playback nearly out of the box. Terrain and imagery stream from Cesium ion for now (decision and cost implications in Section 8).

**Database/Auth:** Supabase — managed Postgres with Row Level Security and built-in auth (magic link, OAuth). The anonymous v1 is built on the account-capable schema from the start; accounts are a feature flag, not a refactor.

**Media storage:** Cloudflare R2, chosen specifically because egress is free. A flight-sharing product's viewing traffic is unpredictable and success-correlated; R2 decouples the bill from popularity. Supabase Storage is deliberately *not* used for media for this reason.

**API:** a small set of endpoints (Section 3.4) as edge functions. The API issues signed R2 upload URLs and writes metadata; media bytes go browser → R2 directly.

### 3.3 The flight bundle

A published flight is a folder in R2:

```
flights/{slug}/flight.json          track + media metadata + settings (versioned)
flights/{slug}/media/{id}_web.jpg   downscaled photo (~1600px, EXIF stripped)
flights/{slug}/media/{id}_thumb.jpg thumbnail for dots/OG image
```

The viewer is deployed once as shared static code and loads any flight by slug. Viewer improvements therefore apply retroactively to every shared flight. `flight.json` carries a `version` field; the viewer must render all versions it has ever shipped.

```json
{
  "version": 1,
  "title": "Niederhorn → Interlaken",
  "date": "2026-06-20",
  "track": { "t0": "2026-06-20T09:40:00Z", "dt": null,
             "points": [[t, lat, lon, alt], "..."] },
  "media": [
    { "id": "m1", "type": "photo", "t": 1180, "end": null,
      "lat": 46.7231, "lon": 7.8724, "alt": 2670,
      "caption": "Cloudbase", "web": "media/m1_web.jpg",
      "thumb": "media/m1_thumb.jpg", "status": "ready" }
  ],
  "settings": { "syncOffsetSec": -7200, "cameraDefault": "free" }
}
```

`type`, `end`, and `status` exist in v1 even though every v1 entry is a ready photo with `end: null` — this is the video readiness described in Section 7.

### 3.4 API surface

`POST /flights` creates a draft (returns slug, manage token, signed upload URLs). `POST /flights/{slug}/publish` confirms uploads and flips visibility. `PATCH /flights/{slug}` and `DELETE /flights/{slug}` require the manage token; delete must purge R2 objects, not just the row. `POST /flights/{slug}/claim` attaches a flight to an authenticated user via its manage token (the account-adoption path). `GET /f/{slug}` serves the viewer shell with per-flight Open Graph tags.

---

## 4. Data model

Designed account- and billing-ready from day one; v1 simply leaves `owner_id` null.

| Table | Key columns | Notes |
|---|---|---|
| `users` | id, email, auth_provider, plan, stripe_customer_id, created_at | Populated only once accounts ship. `plan` defaults `free`. |
| `flights` | id, slug (unique, unguessable), owner_id (nullable FK), title, flight_date, visibility (`unlisted`/`public`), manage_token_hash, bundle_version, bytes_used, created_at | Anonymous flights have null owner; claimable via manage token. |
| `media` | id, flight_id FK, type (`photo`/`video`), status (`ready`/`processing`/`failed`), t_start, t_end (nullable), lat, lon, alt, caption, storage_keys (jsonb), duration_s (nullable), bytes | **One generic table, not a photos table.** `type` + `status` + time range are the entire video-readiness at the schema level. |
| `usage` | user_id FK, period, storage_bytes, flight_count, video_minutes | Updated on every upload/delete from day one; quotas are miserable to retrofit. |
| `subscriptions` | user_id FK, stripe_subscription_id, plan, status, period_end | Wired in the billing phase. |

Row Level Security: owners read/write their rows; anonymous flights are writable only through the API (service role) with a valid manage token; published `flight.json` is served from R2, so viewers never touch Postgres.

---

## 5. Viewer design

The viewer is a pure consumer of `flight.json` — it knows nothing about accounts, plans, or the API beyond fetching the bundle. This keeps it embeddable in the standalone export unchanged.

### 5.1 Scene composition

Terrain and imagery from Cesium ion (World Terrain + world imagery). The track renders as a per-vertex-colored polyline (altitude ramp), with a terrain-clamped shadow line and sparse vertical tether lines connecting track to ground — the tethers proved essential in the prototype for making altitude legible instead of ambiguous. The glider is a point entity driven by a `SampledPositionProperty` over the flight clock. Photo dots are billboards with `disableDepthTestDistance: Infinity` so they are always visible and clickable even behind ridges; this is a deliberate trade of physical correctness for interaction reliability.

### 5.2 Playback chrome

Custom controls replace Cesium's default widgets: play/pause, speed presets, camera mode toggle, live telemetry, and a signature "flight strip" — an altitude-profile canvas that doubles as the scrubber and carries the photo markers. Follow mode positions the camera behind the current heading via `camera.lookAt`, released with `lookAtTransform(IDENTITY)` on exit.

### 5.3 Lessons already learned (from the working prototype)

These are encoded as requirements because each one bit us during prototyping. Library loading must not be a single hard-coded CDN script tag: load CesiumJS with an ordered fallback (official CDN, then jsDelivr), set `CESIUM_BASE_URL` per source, and surface load failure as readable UI, not a console exception. Terrain readiness must be awaited via `Terrain.readyEvent` with a timeout, never assumed; terrain-dependent work (e.g., `sampleTerrainMostDetailed`) must validate results and degrade to a stated, visible fallback — the prototype's silent fallback produced a track floating in space and a confused user. Any degraded state gets a toast naming the likely cause (token asset access, `assets.ion.cesium.com` blocked). The scrub canvas requires `touch-action: none` plus `preventDefault` in pointer handlers, or drags are hijacked by native scrolling and only precise taps register. Cesium spawns web workers, which fail inside sandboxed cross-origin iframes (including chat-preview sandboxes); the viewer targets top-level browsing contexts and documents this. Real IGC data eliminates the prototype's synthetic-altitude grounding hack entirely — recorded altitudes already agree with real terrain — but the terrain diagnostics stay.

### 5.4 Standalone export

Same viewer code and bundle data, inlined: track JSON embedded, photos re-encoded to base64 at export time. Photo-only (embedding video is impractical). The embedded imagery/terrain source must permit streaming from a freely redistributed file — this constrains the ion token strategy (Section 8) and may push the export to an open imagery source even while the hosted app uses ion.

---

## 6. Sharing, privacy, and abuse surface

Slugs are 12+ character nanoids — unguessable, unenumerable. Default visibility is unlisted; a public-gallery flag is a later opt-in. The uploader receives a manage link containing a secret token (hashed at rest); deletion purges storage objects.

Privacy protections are built into the client pipeline, not bolted on: hosted photo copies are re-encoded via canvas, which strips all EXIF (originals contain home-site GPS and device serials); the sync UI reads EXIF locally before it is discarded. The upload flow offers optional track trimming near start and end, since tracklogs often begin at a house or car. Upload UI states plainly that the link is public-if-known. Open Graph tags per flight (title, date, rendered track thumbnail) make links unfurl well in chat apps — a growth feature, but also an expectation-setter that the content is shareable.

Abuse surface at v1 is limited (no comments, no discovery), but the API rate-limits flight creation per IP and caps per-flight photo count and bytes even before billing exists.

---

## 7. Extensibility design

### 7.1 Video

Video differs from photos in three ways, each with a hook already in place. It is large and needs transcoding: the `media.status` field and the request-slot → upload → confirm flow leave room for an async pipeline; the plan is Cloudflare Stream (flat per-minute transcode + HLS delivery) rather than building one. It spans a time range: `t_start`/`t_end` in the schema and `t`/`end` in `flight.json` already model this; the viewer will render a highlighted track segment with a play dot, and the lightbox swaps `<img>` for an HLS player. It costs real money: video is a natural pro-tier entitlement, meaning the pipeline isn't built until paying customers fund it.

### 7.2 Accounts

Magic-link/OAuth via Supabase Auth. Anonymous flights are adopted through the claim endpoint (manage token proves creation). A "my flights" page is a straightforward RLS query. Nothing about the anonymous flow changes.

### 7.3 Subscriptions

Code is structured around entitlements, not plans: a single `can(user, action)` check against a config object — max flights, photos per flight, storage quota, video allowed, video minutes, export allowed, watermark. Every upload path checks entitlements from day one with free-tier limits set generously; monetization later is a config change plus Stripe Checkout and the customer portal. Plausible tiering: free = N flights, photos only, unlisted links; pro = unlimited flights, video, higher storage, no watermark.

---

## 8. Third-party licensing and cost model

**CesiumJS** is Apache-2.0: free for commercial use, no royalties; the only obligation is preserving license notices. The engine imposes nothing on the business model.

**Cesium ion** (terrain/imagery data service) is the metered dependency. Usage of commercial data is measured in sessions, and the free community tier is not intended for companies beyond ~$50K revenue/funding — a commercial plan becomes necessary as revenue arrives, with cost scaling with viewer traffic. Decision for now: ship on ion for best terrain quality and fastest build, with the token domain-restricted to our origins. Standing risk (tracked in Section 10): ion couples infrastructure cost to share-link popularity; the mitigation path is swapping the base layers to open/self-hosted sources (MapTiler terrain, OSM imagery) behind the same viewer interface, possibly keeping ion assets (e.g., 3D buildings) as a pro-tier feature only. The standalone export likely moves to an open imagery source regardless, since redistributing a file that streams ion commercial imagery needs terms review.

**Supabase**: develop on the free tier (note: free projects pause after a week of inactivity — unsuitable for production), launch on Pro at $25/month, which includes a compute credit covering a Micro instance. The real cost model is base-plus-overages (database size, MAUs, bandwidth); keeping media on R2 keeps Supabase's meters small. Expected trajectory: $0 → $25 → $30–60/month.

**Cloudflare R2**: storage ~$0.015/GB-month, zero egress. A 50-photo flight at ~300 KB/web-photo is ~15 MB; ten thousand such flights ≈ 150 GB ≈ ~$2.25/month.

**Stripe**: standard per-transaction fees; no fixed cost until billing ships.

---

## 9. Development plan

Six phases. Each has an exit criterion; a phase isn't done until it's met. Estimates assume one experienced developer part-time and are deliberately coarse.

| Phase | Scope | Est. | Exit criterion |
|---|---|---|---|
| 0 — Foundation | Repo, CI, Astro app shell (viewer split into `src/viewer/*.ts` modules — done); Supabase project with full schema (users, flights, media, usage), RLS policies; R2 bucket + signed-upload worker; entitlements config module | 1–2 wk | An authenticated script can create a flight row and upload a file to R2 via signed URL |
| 1 — Local MVP | IGC/GPX parsing (`igc-parser` + GPX), EXIF via `exifr`, photo downscale/strip pipeline, sync-offset UI with live dots, full Cesium viewer (playback, dots, lightbox, flight strip, follow cam) running entirely on local files | 3–4 wk | A pilot processes a real flight end-to-end locally; viewer handles a 4-hour, 10k-fix IGC at 60 fps |
| 2 — Hosting & sharing | Publish flow (draft → upload → confirm), slug + manage links, viewer-by-slug, OG tags with track thumbnail, delete-with-purge, rate limits and caps | 2–3 wk | A shared link opens on a phone that has never seen the app; deleting removes all R2 objects |
| 3 — Polish & export | Standalone HTML export, track trimming, error/degraded-state UX (CDN fallback, terrain toasts), accessibility pass, mobile layout | 2 wk | Exported file opens from disk offline-except-tiles; Lighthouse a11y ≥ 90 |
| 4 — Accounts | Supabase Auth (magic link + one OAuth), claim-by-manage-token, "my flights" page, usage counters live | 2 wk | An anonymous flight created last month is claimed into a new account |
| 5 — Billing → Video | Stripe Checkout + portal, entitlement enforcement flips on, pro tier launch; then Cloudflare Stream integration, time-range media in viewer, video gated to pro | 3–5 wk | A pro user uploads a video that plays as a track segment; a free user is cleanly upsold |

### 9.1 Sequencing rationale

Phase 1 before any hosting because time-sync UX is the product's hardest interaction problem and needs iteration without backend friction. Phase 0 still precedes it so that Phase 2 is wiring, not modeling. Billing precedes video because video is the thing billing pays for.

### 9.2 Testing strategy

Unit tests for parsers and the sync-offset solver against a corpus of real IGC/GPX files (multiple loggers, midnight-crossing flights, missing altitude). Golden-file tests for `flight.json` serialization across versions. Playwright smoke tests for upload → publish → view on desktop and mobile viewports. A manual device pass for the scrub gesture on iOS/Android, which automated pointer events don't faithfully reproduce. Load test: 10k-fix track, 100 photos.

### 9.3 Instrumentation

From Phase 2: flight creations, publishes, unique viewer sessions per flight (also feeds future ion cost forecasting), export downloads, and error events (CDN fallback triggered, terrain degraded). Privacy-respecting, aggregate-only.

---

## 10. Risks and mitigations

**Ion cost coupling.** Viewer sessions of a viral flight bill to us. Mitigate: domain-restricted token, session metrics from day one, and a base-layer abstraction so open terrain/imagery can be swapped in without touching the viewer's public interface. Decide by end of Phase 2 using real session data.

**Time-sync trust.** If auto-sync guesses wrong and the pilot doesn't notice, photos appear in wrong places and the product looks broken. Mitigate: always show the offset explicitly, make dots visibly slide during adjustment, and flag photos whose GPS EXIF disagrees with the track position by >500 m.

**Large tracklogs.** Multi-day gliding logs reach 50k+ fixes. Mitigate: decimate for the polyline (Douglas-Peucker on position, never on the time series used for playback), cap `flight.json` points with documented resampling.

**Anonymous abuse / illegal content.** Unlisted links can host arbitrary images. Mitigate: caps and rate limits at v1, report link on every flight page, purge tooling; revisit before any public gallery.

**Supabase free-tier pause / vendor drift.** Production never runs on the free tier; pricing figures in Section 8 are checked against current pages before each phase that changes spend.

**Single-developer bus factor on the viewer.** The viewer accumulates subtle Cesium knowledge (Section 5.3). Mitigate: that section is a living document; every viewer bug fixed adds its lesson there.

---

## 11. Open questions

Whether the standalone export ships in Phase 3 with ion imagery pending terms review, or launches with an open imagery source from the start. Whether "public gallery" ever ships, and with what moderation. Whether GPX photo waypoints (some loggers embed them) should seed captions. Pricing points for the pro tier — deferred until Phase 4 usage data exists.

---

## Appendix A — Prototype

A working single-file prototype (`flight-playback-demo.html`) exists: Cesium ion terrain, a real ~7-hour Chelan Butte XC (parsed IGC + eight timestamped photos), full playback chrome including the flight-strip scrubber, rubber-band follow cam, compass, multiphoto lightbox, CDN fallback, and terrain diagnostics. It is the reference implementation for Section 5 and the seed of the Phase 1 viewer.

**Now split out (Phase 0 done):** the single file has been broken into the Astro app described in §3.2 — `src/pages/index.astro` (shell) + `src/styles/global.css` + `src/viewer/*.ts` (the framework-light viewer), with the demo bundle relocated to `public/flights/demo/` in the §3.3 layout (`flight.json` + `media/{id}_web.jpg` / `_thumb.jpg`). `flight-playback-demo.html` is retained as the single-file **standalone-export reference** (§5.4): it is the shape the export takes, and a build target to keep working as the module viewer evolves. `FEATURES.md` catalogs the viewer's behaviors and where each lives in the source.
