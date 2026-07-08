/**
 * Loads a flight bundle (design doc §3.3) and populates shared state: the track,
 * the resolved photo markers, co-location groups, headline stats, and the
 * flight card. The viewer is a pure consumer of flight.json — it knows nothing
 * about accounts, plans, or the API.
 */

import { S, type Photo, type PhotoGroup } from "./state";
import { FLIGHT_URL, DRAFT_SLUG, GROUP_DIST_M } from "./config";
import { loadDraft } from "../ingest/store";
import { $, pad, haversine } from "./util";
import { buildSpeedControls } from "./playback";

/**
 * Obtain the flight to render and a function that turns a bundle-relative media
 * path into a loadable URL. Two sources: a published flight.json (fetched, media
 * resolved against its folder) or an in-browser draft (?draft=slug — media
 * resolved to blob: URLs from IndexedDB, for previewing an edit).
 */
async function loadSource(): Promise<{ b: any; resolveMedia: (p: string) => string }> {
  if (DRAFT_SLUG) {
    const d = await loadDraft(DRAFT_SLUG);
    if (!d) throw new Error(`Draft "${DRAFT_SLUG}" isn't in this browser. Open it from the editor.`);
    const cache = new Map<string, string>();
    const resolveMedia = (p: string) => {
      if (!cache.has(p)) { const blob = d.blobs?.[p]; cache.set(p, blob ? URL.createObjectURL(blob) : ""); }
      return cache.get(p)!;
    };
    showEditReturn(DRAFT_SLUG);
    return { b: d.bundle, resolveMedia };
  }
  const res = await fetch(FLIGHT_URL);
  if (!res.ok) throw new Error(`Couldn't load ${FLIGHT_URL} (HTTP ${res.status})`);
  const base = FLIGHT_URL.replace(/[^/]*$/, "");   // e.g. "/flights/demo/"
  return { b: await res.json(), resolveMedia: (p: string) => encodeURI(base + p) };
}

/** Keep the floating corner buttons stacked just below the flight card: the
 *  "Back to editing" pill (drafts only) on top, then the "Save" pill beneath it.
 *  Re-runs as the card resizes (collapse toggle, description more/less, font
 *  load) or the window changes. */
function placeCornerStack() {
  const card = $("flightCard");
  if (!card) return;
  const back = $("editReturn"), save = $("saveFab");
  const r = card.getBoundingClientRect();
  let top = r.bottom + 8;
  if (back && !back.hidden) {
    back.style.top = `${top}px`;
    back.style.left = `${r.left}px`;
    top += back.offsetHeight + 8;
  }
  if (save) {
    save.style.top = `${top}px`;
    save.style.left = `${r.left}px`;
  }
}

/** Wire the corner stack to follow the card (call once the card exists). */
function initCornerStack() {
  const card = $("flightCard");
  if (!card) return;
  placeCornerStack();
  new ResizeObserver(placeCornerStack).observe(card);
  window.addEventListener("resize", placeCornerStack);
}

/** Reveal the "back to editing" button (draft preview only), then restack. */
function showEditReturn(slug: string) {
  const back = $("editReturn");
  if (!back) return;
  back.setAttribute("href", `/edit?draft=${encodeURIComponent(slug)}`);
  back.hidden = false;
  placeCornerStack();
}

export async function loadBundle() {
  const { b, resolveMedia } = await loadSource();

  S.T0 = Date.parse(b.track.t0);
  S.DT = b.track.dt || 1;
  // a GNSS fix that dropped its altitude leaves a point with no/NaN alt; carry
  // the last good value forward so one gap doesn't poison maxAlt (→ NaN) and
  // blank the altitude-colored track.
  let lastAlt = 0;
  S.pts = b.track.points.map(([t, lat, lon, alt]: number[]) => {
    if (Number.isFinite(alt)) lastAlt = alt;
    return { t, lat, lon, alt: lastAlt };
  });
  S.TOTAL = S.pts[S.pts.length - 1].t;

  /* headline stats — recorded GNSS altitudes are real, so no grounding hack */
  S.flownM = 0; S.maxAlt = -Infinity; S.minAlt = Infinity;
  for (let i = 0; i < S.pts.length; i++) {
    if (i) S.flownM += haversine(S.pts[i - 1], S.pts[i]);
    S.maxAlt = Math.max(S.maxAlt, S.pts[i].alt);
    S.minAlt = Math.min(S.minAlt, S.pts[i].alt);
  }
  S.W = Math.max(1, Math.round(15 / S.DT));          // 15 s climb window
  S.bestClimb = 0;
  for (let i = S.W; i < S.pts.length; i++) {
    S.bestClimb = Math.max(S.bestClimb, (S.pts[i].alt - S.pts[i - S.W].alt) / (S.W * S.DT));
  }

  /* photo markers — lat/lon/alt already resolved against the track in the
     bundle. tPos clamps the capture time into the flight window so photos
     taken just before launch / after landing still pin to the track ends. */
  S.PHOTOS = b.media
    .filter((m: any) => m.type === "photo" && m.status === "ready")
    .map((m: any, i: number): Photo => ({
      i, t: m.t, tPos: Math.max(0, Math.min(S.TOTAL, m.t)),
      lat: m.lat, lon: m.lon, alt: m.alt, caption: m.caption,
      img: resolveMedia(m.web),
      thumb: resolveMedia(m.thumb || m.web),
    }));

  /* text annotations — a labeled point on the track, no image */
  S.ANNOTATIONS = b.media
    .filter((m: any) => m.type === "annotation")
    .map((m: any) => ({
      t: m.t, tPos: Math.max(0, Math.min(S.TOTAL, m.t)),
      lat: m.lat, lon: m.lon, alt: m.alt, text: m.caption || "",
    }));

  /* merge photos + annotations into one time-ordered list so the lightbox
     arrows/swipe/dots step through them as a single sequence of stops */
  S.timeline = [
    ...S.PHOTOS.map((p, idx) => ({ kind: "photo" as const, idx, t: p.t })),
    ...S.ANNOTATIONS.map((a, idx) => ({ kind: "note" as const, idx, t: a.t })),
  ].sort((x, y) => x.t - y.t);

  /* cluster photos taken at the same spot on the track (within GROUP_DIST_M),
     so co-located shots collapse into one multiphoto marker */
  S.groups = [];
  for (const ph of S.PHOTOS) {
    let g = S.groups.find(gr => haversine(gr, ph) < GROUP_DIST_M);
    if (!g) { g = { lat: ph.lat, lon: ph.lon, alt: ph.alt, t: ph.t, members: [] } as PhotoGroup; S.groups.push(g); }
    g.members.push(ph.i);
    ph.group = g;
  }

  /* preload + decode the full-res photos up front so the lightbox switches
     instantly instead of re-fetching several MB on every navigation */
  for (const ph of S.PHOTOS) {
    const im = new Image();
    im.src = ph.img;
    if (im.decode) im.decode().catch(() => {});
    ph.full = im;
  }

  /* flight card */
  document.title = `Skylog — ${b.title}`;
  $("flightTitle").textContent = b.title;
  const day = new Date(b.date + "T00:00:00Z");
  const dateStr = day.toLocaleDateString("en-GB",
    { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  $("flightMeta").textContent = [dateStr, b.pilot, b.glider].filter(Boolean).join(" · ");
  $("stDur").textContent = `${Math.floor(S.TOTAL / 3600)}h ${pad(Math.floor((S.TOTAL % 3600) / 60))}m`;
  $("stMax").textContent = Math.round(S.maxAlt) + " m";
  $("stClimb").textContent = "+" + S.bestClimb.toFixed(1) + " m/s";

  /* pilot's description, collapsed to 3 lines with a More/Less toggle */
  const desc = (b.description || "").trim();
  const descEl = $("flightDesc");
  if (desc) {
    descEl.textContent = desc;
    $("descWrap").hidden = false;
    const overflows = descEl.scrollHeight > descEl.clientHeight + 1;
    $("descToggle").hidden = !overflows;
    if (!overflows) descEl.classList.remove("clamp");
  } else {
    $("descWrap").hidden = true;
  }

  buildSpeedControls();   // speed presets scaled to this flight's length
  initCornerStack();      // stack the Save (and Back-to-editing) pills under the card
}
