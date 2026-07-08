/**
 * Playback: the flight clock tick (telemetry, camera, profile, compass), the
 * altitude-profile scrubber, speed presets, and the seek / animated-scrub logic.
 */

import { S } from "./state";
import { FAST_PLAYBACK_SEC, MAX_MULT, DEFAULT_PLAYBACK_SEC, reducedMotion } from "./config";
import { $, fmtUTC, fmtElapsed, haversine, interpAt } from "./util";
import { C } from "./colors";
import { followCamera, updateCompass } from "./camera";
import { closeLightbox } from "./lightbox";

export function nowSeconds() {
  return Cesium.JulianDate.secondsDifference(S.clock.currentTime, S.clock.startTime);
}

export function onTick() {
  const t = nowSeconds();
  const here = interpAt(t);
  const before = interpAt(Math.max(0, t - 2)), after = interpAt(Math.min(S.TOTAL, t + 2));
  const dt = after.t - before.t || 1;

  const gs = haversine(before, after) / dt * 3.6;
  const vario = (after.alt - before.alt) / dt;

  $("alt").textContent = Math.round(here.alt) + " m";
  $("spd").textContent = Math.round(gs) + " km/h";
  const v = $("vario");
  v.textContent = (vario >= 0 ? "+" : "") + vario.toFixed(1) + " m/s";
  v.className = vario > 0.2 ? "up" : vario < -0.2 ? "down" : "";

  $("tUTC").textContent = fmtUTC(t);
  $("tElapsed").textContent = fmtElapsed(t);

  if (t >= S.TOTAL - 0.5 && S.clock.shouldAnimate) setPlaying(false);

  if (S.cameraMode === "follow") followCamera();
  drawProfile(t);
  updateCompass();

  /* close the panel (photo or annotation) once the flight is scrubbed/played
     away from the open item — but not during a transition that sweeps t on
     purpose. lbTPos tracks whichever media is currently open. */
  if (!S.scrubAnim && $("lightbox").classList.contains("open") && Math.abs(t - S.lbTPos) > 15) {
    closeLightbox();
  }
}

export function setPlaying(on: boolean) {
  if (on) cancelScrub();   // starting playback overrides any photo-transition sweep
  if (on && nowSeconds() >= S.TOTAL - 0.5) S.clock.currentTime = S.clock.startTime.clone();
  S.clock.shouldAnimate = on;
  $("icoPlay").style.display = on ? "none" : "";
  $("icoPause").style.display = on ? "" : "none";
  $("btnPlay").setAttribute("aria-label", on ? "Pause" : "Play flight");
}

/* ---- speed presets ----
   The fastest preset replays the whole track in ~FAST_PLAYBACK_SEC seconds (but
   never faster than MAX_MULT), and the others scale down (½× and ⅕×, plus 1×). */
export function niceMult(v: number) {             // round to a readable value (2 significant figures)
  if (v <= 1) return 1;
  if (v < 10) return Math.round(v);
  const m = Math.pow(10, Math.floor(Math.log10(v)) - 1);
  return Math.round(v / m) * m;
}

export function buildSpeedControls() {
  const maxMult = Math.min(MAX_MULT, niceMult(Math.max(2, S.TOTAL / FAST_PLAYBACK_SEC)));   // ~10 s, capped
  let speeds = [1, maxMult / 5, maxMult / 2, maxMult].map(niceMult);
  speeds = [...new Set(speeds)].filter(v => v >= 1).sort((a, b) => a - b);
  if (speeds.length < 2) speeds = [1, maxMult];
  // default: the preset that plays the flight closest to DEFAULT_PLAYBACK_SEC
  S.defaultMult = speeds.reduce((best, v) =>
    Math.abs(S.TOTAL / v - DEFAULT_PLAYBACK_SEC) < Math.abs(S.TOTAL / best - DEFAULT_PLAYBACK_SEC) ? v : best,
    speeds[0]);
  const seg = $("speedSeg");
  seg.innerHTML = "";
  for (const v of speeds) {
    const btn = document.createElement("button");
    btn.dataset.mult = String(v);
    btn.textContent = v + "×";
    btn.setAttribute("aria-pressed", v === S.defaultMult ? "true" : "false");
    seg.appendChild(btn);
  }
}

/* ================ PROFILE STRIP ================ */
let canvas: any, ctx: any, cw = 0, ch = 0, scrubbing = false;

const X = (t: number) => (t / S.TOTAL) * cw;
const Y = (a: number) => ch - 7 - ((a - (S.minAlt - 80)) / ((S.maxAlt + 140) - (S.minAlt - 80))) * (ch - 15);

function resizeProfile() {
  const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  cw = r.width; ch = r.height;
  canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

const eventT = (e: PointerEvent) => {
  const r = canvas.getBoundingClientRect();
  return Math.min(S.TOTAL, Math.max(0, ((e.clientX - r.left) / r.width) * S.TOTAL));
};

/** Wire up the altitude-profile canvas (call once, after the DOM exists). */
export function initProfile() {
  canvas = $("profile");
  ctx = canvas.getContext("2d");
  new ResizeObserver(() => { resizeProfile(); drawProfile(S.clock ? nowSeconds() : 0); }).observe(canvas);
  resizeProfile();

  // scrub the timeline (photos are opened from their 3D markers, not here)
  canvas.addEventListener("pointerdown", (e: PointerEvent) => {
    scrubbing = true; canvas.setPointerCapture(e.pointerId);
    cancelScrub();   // a manual drag overrides any photo-transition sweep
    e.preventDefault();
    seek(eventT(e));
  });
  canvas.addEventListener("pointermove", (e: PointerEvent) => { if (scrubbing) { e.preventDefault(); seek(eventT(e)); } });
  canvas.addEventListener("pointerup", (e: PointerEvent) => { scrubbing = false; canvas.releasePointerCapture(e.pointerId); });
  canvas.addEventListener("pointercancel", () => { scrubbing = false; });
}

export function drawProfile(t: number) {
  if (!cw || !S.pts.length) return;
  const pts = S.pts;
  ctx.clearRect(0, 0, cw, ch);

  /* altitude area */
  ctx.beginPath();
  ctx.moveTo(0, Y(pts[0].alt));
  const step = Math.max(1, Math.floor(pts.length / cw));
  for (let i = 0; i < pts.length; i += step) ctx.lineTo(X(pts[i].t), Y(pts[i].alt));
  ctx.lineTo(X(S.TOTAL), Y(pts[pts.length - 1].alt));
  ctx.strokeStyle = "rgba(111,183,255,0.95)"; ctx.lineWidth = 1.6; ctx.stroke();
  ctx.lineTo(cw, ch); ctx.lineTo(0, ch); ctx.closePath();
  ctx.fillStyle = "rgba(111,183,255,0.14)"; ctx.fill();

  /* photo + annotation markers (annotations marked the same as photos) */
  const marker = (tPos: number, alt: number) => {
    ctx.beginPath(); ctx.arc(X(tPos), Y(alt), 4.4, 0, 7);
    ctx.fillStyle = C.marker; ctx.fill();
    ctx.lineWidth = 1.6; ctx.strokeStyle = "#0e141b"; ctx.stroke();
  };
  for (const ph of S.PHOTOS) marker(ph.tPos, ph.alt);
  for (const a of S.ANNOTATIONS) marker(a.tPos, a.alt);

  /* playhead */
  const x = X(t);
  ctx.beginPath(); ctx.moveTo(x, 2); ctx.lineTo(x, ch - 2);
  ctx.strokeStyle = "rgba(255,180,84,0.9)"; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.beginPath(); ctx.arc(x, Y(interpAt(t).alt), 4.6, 0, 7);
  ctx.fillStyle = C.marker; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = C.markerInk; ctx.stroke();
}

/* ---- seek + animated scrub ---- */
export function seek(t: number) {
  if (!S.clock) return;
  S.clock.currentTime = Cesium.JulianDate.addSeconds(S.clock.startTime, t, new Cesium.JulianDate());
  if (!S.clock.shouldAnimate) { onTick(); S.viewer.scene.requestRender && S.viewer.scene.requestRender(); }
}

export function cancelScrub() {
  if (S.scrubRAF) cancelAnimationFrame(S.scrubRAF);
  S.scrubRAF = 0; S.scrubAnim = false;
}

/** Sweep the clock from the current time to targetT with an ease-in-out, so
 *  moving between photos glides the playhead/glider/camera between them. */
export function scrubTo(targetT: number) {
  if (!S.clock) return;
  cancelScrub();
  const startT = nowSeconds(), delta = targetT - startT;
  if (reducedMotion || Math.abs(delta) < 0.5) { seek(targetT); return; }
  const dur = Math.min(1200, 420 + Math.abs(delta) / S.TOTAL * 900);   // ms: quick, scales gently
  const t0 = performance.now();
  S.scrubAnim = true;
  const stepFn = (now: number) => {
    const p = Math.min(1, (now - t0) / dur);
    const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;  // ease-in-out quad
    S.clock.currentTime = Cesium.JulianDate.addSeconds(S.clock.startTime, startT + delta * e, new Cesium.JulianDate());
    onTick();
    if (S.viewer.scene.requestRender) S.viewer.scene.requestRender();
    if (p < 1) { S.scrubRAF = requestAnimationFrame(stepFn); }
    else { S.scrubRAF = 0; S.scrubAnim = false; }
  };
  S.scrubRAF = requestAnimationFrame(stepFn);
}
