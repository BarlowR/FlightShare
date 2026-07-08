/**
 * Photo ↔ track time synchronization (design doc §2.1). A photo's position is
 * interpolated between the two nearest track fixes at its capture time plus a
 * user offset. When a photo carries GPS EXIF we can also *solve* for the offset
 * that best places every geotagged photo on the track.
 */

export type TrackPos = { lat: number; lon: number; alt: number };

/** The minimum a track needs for syncing — matches both the parsed `Track` and
 *  the bundle's `track` (which omits `meta`). */
type SyncTrack = { t0: string; points: [number, number, number, number][] };

/** Linear interpolation on the track at time `t` seconds (clamped at both ends). */
export function interpAt(track: SyncTrack, t: number): TrackPos {
  const pts = track.points;
  const last = pts[pts.length - 1][0];
  if (t <= 0) return { lat: pts[0][1], lon: pts[0][2], alt: pts[0][3] };
  if (t >= last) { const p = pts[pts.length - 1]; return { lat: p[1], lon: p[2], alt: p[3] }; }
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid][0] <= t) lo = mid; else hi = mid;
  }
  const a = pts[lo], b = pts[hi], f = (t - a[0]) / (b[0] - a[0] || 1);
  return { lat: a[1] + (b[1] - a[1]) * f, lon: a[2] + (b[2] - a[2]) * f, alt: a[3] + (b[3] - a[3]) * f };
}

/** Track-relative time (s) of a photo taken at `photoMs`, given the track start
 *  and the applied sync offset. */
export function photoTrackTime(track: SyncTrack, photoMs: number, offsetSec: number): number {
  return (photoMs - Date.parse(track.t0)) / 1000 + offsetSec;
}

/** Clamp a track-relative time into the flown window, so shots taken just before
 *  launch / after landing still pin to the track ends (matches bundle.ts). */
export function clampToTrack(track: SyncTrack, t: number): number {
  return Math.max(0, Math.min(track.points[track.points.length - 1][0], t));
}

const R = Math.PI / 180;
function distM(a: TrackPos, b: { lat: number; lon: number }): number {
  const dLat = (b.lat - a.lat) * R, dLon = (b.lon - a.lon) * R;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * R) * Math.cos(b.lat * R) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(s));
}

/**
 * Solve for the sync offset (seconds) that minimizes the total gap between each
 * geotagged photo's GPS point and the track position at its (shifted) time.
 * Coarse sweep over ±14 h (covers any timezone), then a 1 s refine. Returns null
 * if no photo carries usable GPS + time.
 */
export function autoOffset(
  track: SyncTrack,
  photos: { timeMs: number | null; lat: number | null; lon: number | null }[],
): number | null {
  const geo = photos.filter(
    (p): p is { timeMs: number; lat: number; lon: number } =>
      p.timeMs != null && p.lat != null && p.lon != null);
  if (!geo.length) return null;

  const cost = (offset: number) =>
    geo.reduce((sum, p) => sum + distM(interpAt(track, photoTrackTime(track, p.timeMs, offset)), p), 0);

  let best = 0, bestCost = Infinity;
  for (let o = -14 * 3600; o <= 14 * 3600; o += 60) {
    const c = cost(o);
    if (c < bestCost) { bestCost = c; best = o; }
  }
  for (let o = best - 60; o <= best + 60; o++) {
    const c = cost(o);
    if (c < bestCost) { bestCost = c; best = o; }
  }
  return best;
}

/**
 * Best sync offset (seconds) for a batch of photos. Uses the precise GPS solve
 * when photos are geotagged; otherwise falls back to the whole-hour shift that
 * lands the most timestamps inside the flight window. EXIF has no timezone, so
 * an untagged photo taken during the flight is typically off by an exact number
 * of hours — this recovers that. Per-photo drift (seconds) is then fine-tuned by
 * scrubbing. Returns 0 when no photo carries a timestamp.
 */
export function fitOffset(
  track: SyncTrack,
  photos: { timeMs: number | null; lat: number | null; lon: number | null }[],
): number {
  const gps = autoOffset(track, photos);
  if (gps != null) return gps;

  const timed = photos.filter((p): p is typeof p & { timeMs: number } => p.timeMs != null);
  if (!timed.length) return 0;

  const last = track.points[track.points.length - 1][0];
  let best = 0, bestIn = -1;
  for (let h = -14; h <= 14; h++) {
    const off = h * 3600;
    let inWin = 0;
    for (const p of timed) {
      const t = photoTrackTime(track, p.timeMs, off);
      if (t >= 0 && t <= last) inWin++;
    }
    if (inWin > bestIn) { bestIn = inWin; best = off; }
  }
  return best;
}
