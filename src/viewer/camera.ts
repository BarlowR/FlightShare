/**
 * Camera behaviour: the rubber-band follow cam, the photo-panel pan offset, and
 * the compass. Follow mode anchors an orbit center in the glider's local
 * East-North-Up frame (mouse drags orbit that trackpoint; the frame is
 * ground-aligned so the view never rotates on its own). The center rubber-bands
 * toward the glider in real wall-clock time — the same feel whether playing fast,
 * slow, or scrubbing by hand.
 */

import { S } from "./state";
import { RAD, FOLLOW_RANGE, FOLLOW_PITCH, FOLLOW_TAU } from "./config";
import { $ } from "./util";

/** Distance that frames ~2/3 of the track's extent for the default overhead view. */
export function followViewRange() {
  if (!S.trackRadius) return FOLLOW_RANGE;
  const fovy = (S.viewer.camera.frustum && S.viewer.camera.frustum.fovy) || 0.6;
  return (2 / 3) * S.trackRadius / Math.tan(fovy / 2);
}

/** One-time follow pose: north up (heading 0), mostly overhead, ~2/3 of track in view. */
export function frameFollow() {
  if (!S.posProp || !S.viewer) return;
  const p = S.posProp.getValue(S.clock.currentTime);
  if (!p) return;
  S.followCenter = Cesium.Cartesian3.clone(p, S.followCenter || new Cesium.Cartesian3());
  S.followLastMs = performance.now();
  const transform = Cesium.Transforms.eastNorthUpToFixedFrame(S.followCenter);
  S.viewer.camera.lookAtTransform(transform, new Cesium.HeadingPitchRange(0, FOLLOW_PITCH, followViewRange()));
}

/** Per-frame follow: ease the orbit center toward the glider, preserving the
 *  user's manual orbit/zoom, then keep the subject clear of an open photo panel. */
export function followCamera() {
  const p = S.posProp.getValue(S.clock.currentTime);
  if (!p) return;
  if (!S.followCenter) { frameFollow(); return; }
  const now = performance.now();
  let dt = (now - S.followLastMs) / 1000;
  S.followLastMs = now;
  if (!(dt > 0)) dt = 0.016;
  dt = Math.min(dt, 0.1);
  const k = 1 - Math.exp(-dt / FOLLOW_TAU);
  Cesium.Cartesian3.lerp(S.followCenter, p, k, S.followCenter);
  // carry the user's current orbit offset onto the re-centered frame
  const offset = Cesium.Cartesian3.clone(S.viewer.camera.position, new Cesium.Cartesian3());
  const transform = Cesium.Transforms.eastNorthUpToFixedFrame(S.followCenter);
  S.viewer.camera.lookAtTransform(transform, offset);
  applyPanOffset();
}

/** Switch camera mode (from the Free/Follow toggle). */
export function setCameraMode(mode: "free" | "follow") {
  S.cameraMode = mode;
  if (mode === "free") {
    S.viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);   // back to globe pan/zoom
    S.followCenter = null;
  } else {
    frameFollow();   // re-establish the zoomed-out orbit pose
  }
}

/**
 * When the photo panel is open it covers part of the window; rather than
 * centering the followed point behind the panel, pan the camera so the subject
 * sits in the free area. A real camera rotation, re-applied each frame in follow
 * mode (where lookAtTransform re-centers first, so it never compounds).
 */
export function applyPanOffset() {
  if (!S.viewer || !$("lightbox").classList.contains("open")) return;
  const cw = S.viewer.scene.canvas.clientWidth, ch = S.viewer.scene.canvas.clientHeight;
  if (!cw || !ch) return;
  const fr = S.viewer.scene.camera.frustum;
  if (typeof fr.fov !== "number") return;            // only the 3D perspective frustum
  const r = $("lightbox").getBoundingClientRect();
  const aspect = cw / ch;
  if (r.right - r.left >= cw - 40) {
    // full-width sheet: pan vertically so the subject is in the taller free strip
    const fovy = aspect >= 1 ? 2 * Math.atan(Math.tan(fr.fov / 2) / aspect) : fr.fov;
    const fy = (r.top <= 40 ? (r.bottom + ch) / 2 : r.top / 2) / ch;
    S.viewer.camera.lookUp(Math.atan((2 * fy - 1) * Math.tan(fovy / 2)));
  } else {
    // side panel: pan sideways so the subject lands in the free strip
    const fovx = aspect >= 1 ? fr.fov : 2 * Math.atan(Math.tan(fr.fov / 2) * aspect);
    const f = (r.left > cw - r.right ? r.left / 2 : (r.right + cw) / 2) / cw;
    S.viewer.camera.lookRight(Math.atan((1 - 2 * f) * Math.tan(fovx / 2)));
  }
}

/** Spin the compass rose so its red arrow points to true north on screen. */
export function updateCompass() {
  if (!S.viewer) return;
  const h = Cesium.Math.toDegrees(S.viewer.camera.heading);
  $("compassRose").style.transform = `rotate(${-h}deg)`;
}
