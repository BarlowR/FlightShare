/**
 * Track scrubber for the edit page: a top-down map view of the flight and an
 * altitude-vs-time plot, sharing one playhead. Dragging the altitude plot (or
 * clicking the map) moves the playhead and reports the new time, which the
 * caller uses to re-place the selected media item on the track.
 *
 * The plan view is drawn in Web Mercator over satellite imagery tiles (Esri
 * World Imagery — token-free, and a close match to the aerial imagery the 3D
 * viewer streams from Cesium ion). Pure canvas, no dependency; colors come from
 * the CSS custom properties so the plots stay on-palette.
 */

type Pt = [number, number, number, number];   // [t, lat, lon, alt]

export type Scrubber = {
  /** Move the playhead to time `t` (seconds) without firing onScrub. */
  setTime(t: number): void;
  /** Re-measure the canvases and repaint (call after the panel becomes visible). */
  relayout(): void;
  destroy(): void;
};

/* ---- satellite tiles (shared across scrubber instances) ---- */
const TILE = (z: number, x: number, y: number) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
const tileCache = new Map<string, HTMLImageElement>();
function tile(z: number, x: number, y: number, onLoad: () => void): HTMLImageElement {
  const key = `${z}/${x}/${y}`;
  let img = tileCache.get(key);
  if (img) return img;
  img = new Image();
  img.onload = onLoad;
  img.src = TILE(z, x, y);           // no crossOrigin: we only drawImage, never read pixels back
  tileCache.set(key, img);
  return img;
}

const TILE_SIZE = 256;
const MAX_Z = 18;
const LAT_LIMIT = 85.05112878;   // Web Mercator pole clamp
const worldSize = (z: number) => TILE_SIZE * 2 ** z;
const lonToWX = (lon: number, z: number) => ((lon + 180) / 360) * worldSize(z);
const latToWY = (lat: number, z: number) => {
  const s = Math.sin(Math.max(-LAT_LIMIT, Math.min(LAT_LIMIT, lat)) * Math.PI / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * worldSize(z);
};

export function createScrubber(
  plan: HTMLCanvasElement,
  altc: HTMLCanvasElement,
  points: Pt[],
  onScrub: (t: number) => void,
  origTime: number | null = null,   // photo's original (EXIF-derived) track time, for a reference mark
): Scrubber {
  const last = points[points.length - 1][0] || 1;

  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  let minAlt = Infinity, maxAlt = -Infinity;
  for (const [, la, lo, al] of points) {
    minLat = Math.min(minLat, la); maxLat = Math.max(maxLat, la);
    minLon = Math.min(minLon, lo); maxLon = Math.max(maxLon, lo);
    minAlt = Math.min(minAlt, al); maxAlt = Math.max(maxAlt, al);
  }
  // pad the bbox so the track isn't jammed against the frame
  const padLat = (maxLat - minLat) * 0.12 || 0.002, padLon = (maxLon - minLon) * 0.12 || 0.002;
  const bb = { w: minLon - padLon, e: maxLon + padLon, s: minLat - padLat, n: maxLat + padLat };

  const css = (n: string, fb: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || fb;
  const accent = css("--accent", "#d6bd9b");
  const grid = "rgba(245, 239, 225, 0.10)";

  let cur = 0;
  // last plan transform, for hit-testing clicks
  let pz = 0, pOx = 0, pOy = 0;
  const planSX = (lon: number) => lonToWX(lon, pz) - pOx;
  const planSY = (lat: number) => latToWY(lat, pz) - pOy;

  /* interpolate lat/lon/alt at time t (binary search on the track) */
  function at(t: number): { lat: number; lon: number; alt: number } {
    if (t <= 0) { const p = points[0]; return { lat: p[1], lon: p[2], alt: p[3] }; }
    if (t >= last) { const p = points[points.length - 1]; return { lat: p[1], lon: p[2], alt: p[3] }; }
    let lo = 0, hi = points.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (points[mid][0] <= t) lo = mid; else hi = mid; }
    const a = points[lo], b = points[hi], f = (t - a[0]) / (b[0] - a[0] || 1);
    return { lat: a[1] + (b[1] - a[1]) * f, lon: a[2] + (b[2] - a[2]) * f, alt: a[3] + (b[3] - a[3]) * f };
  }

  /** Size a canvas to its CSS box at device pixel ratio; return ctx + CSS dims. */
  function fit(c: HTMLCanvasElement) {
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth || 200, h = c.clientHeight || 140;
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  let raf = 0;
  const scheduleRedraw = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; drawPlan(); }); };

  /* ---- plan view (top-down, over satellite imagery) ---- */
  function drawPlan() {
    const { ctx, w, h } = fit(plan);
    const p = 8, availW = w - 2 * p, availH = h - 2 * p;

    // largest zoom (capped) at which the padded bbox fits the canvas
    let z = MAX_Z;
    for (; z > 0; z--) {
      const sx = lonToWX(bb.e, z) - lonToWX(bb.w, z);
      const sy = latToWY(bb.s, z) - latToWY(bb.n, z);
      if (sx <= availW && sy <= availH) break;
    }
    const spanX = lonToWX(bb.e, z) - lonToWX(bb.w, z);
    const spanY = latToWY(bb.s, z) - latToWY(bb.n, z);
    // world-pixel of the canvas's top-left, so the track bbox is centered
    pz = z;
    pOx = lonToWX(bb.w, z) - (w - spanX) / 2;
    pOy = latToWY(bb.n, z) - (h - spanY) / 2;

    ctx.clearRect(0, 0, w, h);
    ctx.save();
    roundClip(ctx, w, h, 10);
    ctx.fillStyle = "#0a0606"; ctx.fillRect(0, 0, w, h);

    // draw the satellite tiles covering the viewport
    const n = 2 ** z;
    const tx0 = Math.floor(pOx / TILE_SIZE), tx1 = Math.floor((pOx + w) / TILE_SIZE);
    const ty0 = Math.floor(pOy / TILE_SIZE), ty1 = Math.floor((pOy + h) / TILE_SIZE);
    for (let tx = tx0; tx <= tx1; tx++) {
      for (let ty = ty0; ty <= ty1; ty++) {
        if (ty < 0 || ty >= n) continue;
        const wrapX = ((tx % n) + n) % n;
        const img = tile(z, wrapX, ty, scheduleRedraw);
        if (img.complete && img.naturalWidth) {
          ctx.drawImage(img, tx * TILE_SIZE - pOx, ty * TILE_SIZE - pOy, TILE_SIZE, TILE_SIZE);
        }
      }
    }

    // slight darken so the track reads over bright imagery
    ctx.fillStyle = "rgba(10, 6, 6, 0.22)"; ctx.fillRect(0, 0, w, h);

    // track: a dark casing under a bright line
    const drawTrack = (color: string, width: number) => {
      ctx.beginPath();
      for (let i = 0; i < points.length; i++) {
        const x = planSX(points[i][2]), y = planSY(points[i][1]);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.stroke();
    };
    drawTrack("rgba(10,6,6,0.7)", 4);
    drawTrack(accent, 2);

    const pos = at(cur);
    dot(ctx, planSX(pos.lon), planSY(pos.lat));

    ctx.restore();
    // attribution
    ctx.fillStyle = "rgba(245,239,225,0.5)"; ctx.font = "9px system-ui, sans-serif"; ctx.textAlign = "right";
    ctx.fillText("Imagery © Esri", w - 5, h - 5);
    ctx.textAlign = "left";
  }

  /* ---- altitude vs time ---- */
  function drawAlt() {
    const { ctx, w, h } = fit(altc);
    ctx.clearRect(0, 0, w, h);
    const p = 10, altSpan = (maxAlt - minAlt) || 1;
    const X = (t: number) => p + (t / last) * (w - 2 * p);
    const Y = (a: number) => (h - p) - ((a - minAlt) / altSpan) * (h - 2 * p);

    ctx.strokeStyle = grid; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(p, h - p); ctx.lineTo(w - p, h - p); ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(X(points[0][0]), h - p);
    for (const pt of points) ctx.lineTo(X(pt[0]), Y(pt[3]));
    ctx.lineTo(X(last), h - p); ctx.closePath();
    ctx.fillStyle = "rgba(214, 189, 155, 0.12)"; ctx.fill();
    ctx.beginPath();
    for (let i = 0; i < points.length; i++) { const x = X(points[i][0]), y = Y(points[i][3]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.strokeStyle = css("--muted", "#b2a49b"); ctx.lineWidth = 1.5; ctx.stroke();

    // reference mark: the photo's original (EXIF) time, dashed. Clamped into the
    // plot so an out-of-window capture time still shows at the nearest edge.
    if (origTime != null && Number.isFinite(origTime)) {
      const ox = X(Math.max(0, Math.min(last, origTime)));
      const sky = css("--sky", "#6fb7ff");
      ctx.save();
      ctx.setLineDash([4, 3]); ctx.strokeStyle = sky; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(ox, p); ctx.lineTo(ox, h - p); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = sky; ctx.beginPath();   // little downward flag at the top
      ctx.moveTo(ox - 3, p); ctx.lineTo(ox + 3, p); ctx.lineTo(ox, p + 4); ctx.closePath(); ctx.fill();
      ctx.font = "9px system-ui, sans-serif"; ctx.textAlign = ox > (w - 30) ? "right" : "left";
      ctx.fillText("original", ox + (ox > (w - 30) ? -5 : 5), p + 8);
      ctx.textAlign = "left"; ctx.restore();
    }

    const px = X(cur), pa = at(cur).alt;
    ctx.strokeStyle = accent; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px, p); ctx.lineTo(px, h - p); ctx.stroke();
    dot(ctx, px, Y(pa));
  }

  function dot(ctx: CanvasRenderingContext2D, x: number, y: number) {
    ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(10,6,6,0.9)"; ctx.lineWidth = 1.5; ctx.stroke();
  }

  function roundClip(ctx: CanvasRenderingContext2D, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(r, 0); ctx.arcTo(w, 0, w, h, r); ctx.arcTo(w, h, 0, h, r);
    ctx.arcTo(0, h, 0, 0, r); ctx.arcTo(0, 0, w, 0, r); ctx.closePath(); ctx.clip();
  }

  function draw() { drawPlan(); drawAlt(); }

  /* ---- scrubbing ---- */
  function altTimeFromEvent(e: PointerEvent): number {
    const r = altc.getBoundingClientRect(), p = 10;
    const f = (e.clientX - r.left - p) / (r.width - 2 * p);
    return Math.max(0, Math.min(last, f * last));
  }
  function planTimeFromEvent(e: PointerEvent): number {
    // nearest track point to the click, using the last drawn plan transform
    const r = plan.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    let bt = 0, bd = Infinity;
    for (const pt of points) {
      const d = (planSX(pt[2]) - mx) ** 2 + (planSY(pt[1]) - my) ** 2;
      if (d < bd) { bd = d; bt = pt[0]; }
    }
    return bt;
  }

  // one controller for every listener this instance adds; destroy() aborts it so
  // no stale drag handlers linger on the shared canvases (each old handler would
  // otherwise keep scrubbing its own photo — moving one photo would move others).
  const ac = new AbortController();
  const sig = { signal: ac.signal };

  function bindDrag(canvas: HTMLCanvasElement, timeFrom: (e: PointerEvent) => number) {
    let dragging = false;
    const move = (e: PointerEvent) => { cur = timeFrom(e); draw(); onScrub(cur); };
    canvas.addEventListener("pointerdown", (e) => { dragging = true; canvas.setPointerCapture(e.pointerId); move(e); }, sig);
    canvas.addEventListener("pointermove", (e) => { if (dragging) move(e); }, sig);
    const up = (e: PointerEvent) => { dragging = false; try { canvas.releasePointerCapture(e.pointerId); } catch {} };
    canvas.addEventListener("pointerup", up, sig);
    canvas.addEventListener("pointercancel", up, sig);
  }
  bindDrag(altc, altTimeFromEvent);
  bindDrag(plan, planTimeFromEvent);

  window.addEventListener("resize", () => draw(), sig);

  draw();
  return {
    setTime(t) { cur = Math.max(0, Math.min(last, t)); draw(); },
    relayout() { draw(); },
    destroy() { ac.abort(); if (raf) cancelAnimationFrame(raf); },
  };
}
