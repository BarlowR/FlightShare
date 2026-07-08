/**
 * Tracklog parsing (browser-side). Turns an IGC or GPX file into the normalized
 * time series the flight bundle uses (design doc §2.1, §3.3):
 *
 *   { t0: ISO-UTC of the first fix, dt: nominal spacing s, points: [[t,lat,lon,alt], …] }
 *
 * `t` on each point is seconds since t0. `dt` is only a nominal cadence (the
 * viewer uses it to size its climb window); points carry their own `t`, so a
 * non-uniform log stays correct.
 */

/** Free-text flight details read from the file's headers, when present. */
export type TrackMeta = { pilot?: string; glider?: string; site?: string };

export type Track = {
  t0: string;                     // ISO-8601 UTC of the first fix
  dt: number;                     // nominal sample spacing, seconds
  points: [number, number, number, number][];   // [t, lat, lon, alt]
  meta: TrackMeta;                // pilot / glider / site, if the file carries them
};

/** Dispatch on file extension / content. Throws with a readable message on junk. */
export function parseTracklog(name: string, text: string): Track {
  const ext = name.toLowerCase().split(".").pop();
  if (ext === "gpx" || /^\s*<\?xml|<gpx[\s>]/.test(text)) return parseGPX(text);
  if (ext === "igc" || /^A[A-Z0-9]{3}/m.test(text)) return parseIGC(text);
  throw new Error(`Unrecognized tracklog "${name}" — expected .igc or .gpx`);
}

/* ------------------------------------------------------------------ IGC ---- */

/**
 * IGC B-record (fixed columns, all UTC):
 *   B HHMMSS  DDMMmmm[N|S]  DDDMMmmm[E|W]  [A|V]  PPPPP  GGGGG
 *   0 1----6  7--------14   15--------23   24     25-29  30-34
 * Minutes are stored as thousandths (MMmmm = minutes × 1000). GNSS altitude
 * (cols 30-34) is preferred over pressure altitude, matching the viewer's
 * assumption that recorded GNSS heights are real (bundle.ts).
 */
export function parseIGC(text: string): Track {
  const lines = text.split(/\r?\n/);

  // Flight date from the HFDTE header: "HFDTE DDMMYY" or "HFDTEDATE:DDMMYY,NN".
  let dd = 1, mm = 1, yy = 2000;
  for (const l of lines) {
    const m = l.match(/^HFDTE(?:DATE:)?(\d{2})(\d{2})(\d{2})/);
    if (m) { dd = +m[1]; mm = +m[2]; yy = 2000 + +m[3]; break; }
  }

  // Flight details from H-records: pilot (PLT), glider type (GTY) / id (GID),
  // site (SIT). Form is "H<src><3-code><label>:<value>", e.g.
  // "HFPLTPILOTINCHARGE:Robert Barlow", "HFGTYGLIDERTYPE:Gin Camino 2".
  const meta: TrackMeta = {};
  for (const l of lines) {
    const m = l.match(/^H.([A-Z]{3})[^:]*:(.*)$/);
    if (!m) continue;
    const [, code, value] = m;
    const v = value.trim();
    if (!v) continue;
    if (code === "PLT") meta.pilot = v;
    else if (code === "GTY") meta.glider = v;
    else if (code === "GID" && !meta.glider) meta.glider = v;
    else if (code === "SIT") meta.site = v;
  }

  const raw: { sec: number; lat: number; lon: number; alt: number }[] = [];
  let prevSec = -1, dayRoll = 0;
  for (const l of lines) {
    if (l[0] !== "B" || l.length < 35) continue;
    const hh = +l.slice(1, 3), mi = +l.slice(3, 5), ss = +l.slice(5, 7);
    let sec = hh * 3600 + mi * 60 + ss;
    if (prevSec >= 0 && sec < prevSec - 60) dayRoll += 86400;   // past-midnight flight
    prevSec = sec;
    sec += dayRoll;

    const lat = igcDeg(l.slice(7, 9), l.slice(9, 14), l[14], "S");
    const lon = igcDeg(l.slice(15, 18), l.slice(18, 23), l[23], "W");
    const gnss = +l.slice(30, 35), press = +l.slice(25, 30);
    const alt = gnss || press || 0;
    if (Number.isFinite(lat) && Number.isFinite(lon)) raw.push({ sec, lat, lon, alt });
  }
  if (raw.length < 2) throw new Error("IGC file has no usable B-record fixes");

  const base = raw[0].sec;
  const t0 = new Date(Date.UTC(yy, mm - 1, dd, 0, 0, base)).toISOString();
  const points = raw.map((p) =>
    [p.sec - base, round(p.lat, 6), round(p.lon, 6), Math.round(p.alt)] as [number, number, number, number]);
  return { t0, dt: nominalDt(points), points, meta };
}

/** DDMM.mmm (deg + minutes×1000) → signed decimal degrees. */
function igcDeg(deg: string, minThousandths: string, hemi: string, neg: string): number {
  const d = +deg + +minThousandths / 1000 / 60;
  return hemi === neg ? -d : d;
}

/* ------------------------------------------------------------------ GPX ---- */

/**
 * GPX <trkpt lat lon><ele><time></trkpt>. When points carry <time> we build a
 * real clock (t0 + seconds); a GPX without timestamps can't be photo-synced, so
 * we fall back to 1 Hz index time and a synthetic epoch t0.
 */
export function parseGPX(text: string): Track {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("GPX is not valid XML");
  const pts = Array.from(doc.getElementsByTagName("trkpt"));
  if (pts.length < 2) throw new Error("GPX file has no <trkpt> track points");

  const rows = pts.map((p) => {
    const timeEl = p.getElementsByTagName("time")[0];
    const eleEl = p.getElementsByTagName("ele")[0];
    return {
      lat: +(p.getAttribute("lat") || NaN),
      lon: +(p.getAttribute("lon") || NaN),
      alt: eleEl ? +(eleEl.textContent || 0) : 0,
      ms: timeEl ? Date.parse(timeEl.textContent || "") : NaN,
    };
  }).filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon));

  const timed = rows.every((r) => Number.isFinite(r.ms));
  const baseMs = timed ? rows[0].ms : Date.now();
  const t0 = new Date(baseMs).toISOString();
  const points = rows.map((r, i) =>
    [timed ? Math.round((r.ms - baseMs) / 1000) : i,
     round(r.lat, 6), round(r.lon, 6), Math.round(r.alt)] as [number, number, number, number]);
  // GPX has no standard pilot/glider headers; leave details for manual entry.
  return { t0, dt: nominalDt(points), points, meta: {} };
}

/* --------------------------------------------------------------- helpers ---- */

/** Median gap between fixes, clamped to a sane [1, 60] s; the viewer's climb
 *  window is derived from this. */
function nominalDt(points: [number, number, number, number][]): number {
  const gaps: number[] = [];
  for (let i = 1; i < points.length; i++) gaps.push(points[i][0] - points[i - 1][0]);
  gaps.sort((a, b) => a - b);
  const med = gaps[gaps.length >> 1] || 1;
  return Math.min(60, Math.max(1, Math.round(med)));
}

const round = (n: number, d: number) => { const f = 10 ** d; return Math.round(n * f) / f; };
