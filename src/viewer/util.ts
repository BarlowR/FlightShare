/** Small shared helpers: DOM lookup, formatting, geo math, the toast. */

import { S, type TrackPoint } from "./state";
import { RAD } from "./config";
import { C } from "./colors";

/** getElementById as `any` — the viewer knows its own markup, so skip the null churn. */
export const $ = (id: string): any => document.getElementById(id);

export const pad = (n: number) => String(n).padStart(2, "0");

export const fmtUTC = (t: number) => {
  const d = new Date(S.T0 + t * 1000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
};

export const fmtElapsed = (t: number) => {
  t = Math.max(0, Math.round(t));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return h ? `+${h}:${pad(m)}:${pad(s)}` : `+${pad(m)}:${pad(s)}`;
};

export function haversine(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const dLat = (b.lat - a.lat) * RAD, dLon = (b.lon - a.lon) * RAD;
  const s = Math.sin(dLat / 2) ** 2 +
            Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(s));
}

/** Linear interpolation on the track, clamped at both ends. Binary search: the
 *  track is uniformly sampled, but a bsearch stays correct if it isn't. */
export function interpAt(t: number): TrackPoint {
  const pts = S.pts;
  if (!pts.length) return { t: 0, lat: 0, lon: 0, alt: 0 };
  if (t <= 0) return pts[0];
  if (t >= S.TOTAL) return pts[pts.length - 1];
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].t <= t) lo = mid; else hi = mid;
  }
  const a = pts[lo], b = pts[hi], f = (t - a.t) / (b.t - a.t || 1);
  return {
    t,
    lat: a.lat + (b.lat - a.lat) * f,
    lon: a.lon + (b.lon - a.lon) * f,
    alt: a.alt + (b.alt - a.alt) * f,
  };
}

/** Track color ramp, scaled to the flight's max height (0 → maxAlt). */
export function rampColor(alt: number): number[] {
  const f = Math.min(1, Math.max(0, alt / S.maxAlt));
  return C.trackLow.map((c, i) => Math.round(c + (C.trackHigh[i] - c) * f));
}

export function showToast(msg: string, sticky = false) {
  $("toastMsg").textContent = msg;
  $("toast").classList.add("show");
  if (!sticky) setTimeout(() => $("toast").classList.remove("show"), 9000);
}
