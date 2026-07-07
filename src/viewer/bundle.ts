/**
 * Loads a flight bundle (design doc §3.3) and populates shared state: the track,
 * the resolved photo markers, co-location groups, headline stats, and the
 * flight card. The viewer is a pure consumer of flight.json — it knows nothing
 * about accounts, plans, or the API.
 */

import { S, type Photo, type PhotoGroup } from "./state";
import { FLIGHT_URL, GROUP_DIST_M } from "./config";
import { $, pad, haversine } from "./util";
import { buildSpeedControls } from "./playback";

export async function loadBundle() {
  const res = await fetch(FLIGHT_URL);
  if (!res.ok) throw new Error(`Couldn't load ${FLIGHT_URL} (HTTP ${res.status})`);
  const b = await res.json();
  S.bundleBase = FLIGHT_URL.replace(/[^/]*$/, "");   // e.g. "/flights/demo/"

  S.T0 = Date.parse(b.track.t0);
  S.DT = b.track.dt || 1;
  S.pts = b.track.points.map(([t, lat, lon, alt]: number[]) => ({ t, lat, lon, alt }));
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
      img: encodeURI(S.bundleBase + m.web),
      thumb: encodeURI(S.bundleBase + (m.thumb || m.web)),
    }));

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
}
