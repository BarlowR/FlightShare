/**
 * The photo panel (half-screen, non-modal). Opening a photo sweeps the flight
 * to where it was taken and, when several photos share a spot, shows a strip of
 * the co-located thumbnails to browse.
 */

import { S } from "./state";
import { $, fmtUTC } from "./util";
import { setPlaying, scrubTo } from "./playback";
import { applyPanOffset } from "./camera";

export function openLightbox(i: number) {
  S.lbIndex = (i + S.PHOTOS.length) % S.PHOTOS.length;
  const ph = S.PHOTOS[S.lbIndex];
  $("lbImg").src = ph.img;
  $("lbImg").alt = ph.caption;
  $("lbCaption").textContent = ph.caption;
  $("lbTime").textContent = fmtUTC(ph.t);
  $("lbAlt").textContent = Math.round(ph.alt) + " m";
  $("lbCount").textContent = `${S.lbIndex + 1} of ${S.PHOTOS.length}`;

  /* group browser: if this photo shares a spot with others, show a strip of the
     co-located thumbnails and a "N here" chip; otherwise hide them */
  const grp = ph.group;
  const strip = $("lbStrip"), spot = $("lbSpot");
  if (grp && grp.members.length > 1) {
    strip.innerHTML = "";
    for (const mi of grp.members) {
      const p = S.PHOTOS[mi];
      const btn = document.createElement("button");
      btn.className = "lb-thumb" + (mi === S.lbIndex ? " active" : "");
      btn.style.backgroundImage = `url("${p.thumb}")`;
      btn.title = p.caption;
      btn.setAttribute("aria-label", p.caption);
      btn.addEventListener("click", () => openLightbox(mi));
      strip.appendChild(btn);
    }
    strip.style.display = "flex";
    spot.textContent = `◉ ${grp.members.indexOf(S.lbIndex) + 1} of ${grp.members.length} here`;
    spot.style.display = "";
  } else {
    strip.style.display = "none";
    spot.style.display = "none";
  }

  /* pagination dots: one per photo in the flight, current one highlighted */
  const dots = $("lbDots");
  if (dots.childElementCount !== S.PHOTOS.length) {
    dots.innerHTML = "";
    S.PHOTOS.forEach((p, k) => {
      const d = document.createElement("button");
      d.setAttribute("role", "tab");
      d.setAttribute("aria-label", `Photo ${k + 1}: ${p.caption}`);
      d.addEventListener("click", () => openLightbox(k));
      dots.appendChild(d);
    });
  }
  for (let k = 0; k < dots.children.length; k++) {
    dots.children[k].setAttribute("aria-current", String(k === S.lbIndex));
  }

  $("lightbox").classList.add("open");
  setPlaying(false);

  /* sweep the flight to where this photo was taken. In follow mode those ticks
     also pan the view into the free area (applyPanOffset). */
  scrubTo(ph.tPos);

  /* in free-orbit mode, fly the globe to the photo location, then pan it into
     the area the panel leaves free */
  if (S.viewer && S.cameraMode === "free") {
    const pos = Cesium.Cartesian3.fromDegrees(ph.lon, ph.lat, ph.alt);
    S.viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(pos, 500), {
      duration: 1.1,
      offset: new Cesium.HeadingPitchRange(
        Cesium.Math.toRadians(-35), Cesium.Math.toRadians(-22), 2400),
      complete: applyPanOffset,
    });
  }
}

export function closeLightbox() {
  $("lightbox").classList.remove("open");
}

/** Horizontal swipe on the photo → previous/next. Call once at startup. */
export function initLightboxGestures() {
  const img = $("lbImg");
  let x0 = 0, y0 = 0, active = false;
  img.addEventListener("pointerdown", (e: PointerEvent) => {
    active = true; x0 = e.clientX; y0 = e.clientY;
  });
  img.addEventListener("pointerup", (e: PointerEvent) => {
    if (!active) return;
    active = false;
    const dx = e.clientX - x0, dy = e.clientY - y0;
    // mostly-horizontal drag past a threshold: swipe left = next, right = prev
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      openLightbox(S.lbIndex + (dx < 0 ? 1 : -1));
    }
  });
  img.addEventListener("pointercancel", () => { active = false; });
  img.addEventListener("dragstart", (e: Event) => e.preventDefault());

  /* mobile: a click (not a drag) on the globe outside the panel closes it. A
     drag is an orbit, so it's ignored; a tap on a photo marker is left to the
     scene's picker to switch photos instead of closing. */
  const mobile = () => window.matchMedia("(max-width: 880px)").matches;
  let dx0 = 0, dy0 = 0, down = false;
  document.addEventListener("pointerdown", (e: PointerEvent) => {
    down = $("lightbox").classList.contains("open") && mobile() &&
           !$("lightbox").contains(e.target as Node) &&
           $("cesiumContainer").contains(e.target as Node);
    dx0 = e.clientX; dy0 = e.clientY;
  }, true);
  document.addEventListener("pointerup", (e: PointerEvent) => {
    if (!down) return;
    down = false;
    if (Math.hypot(e.clientX - dx0, e.clientY - dy0) > 8) return;   // it was a drag/orbit
    // don't close if the tap hit a photo marker — that switches photos instead
    if (S.viewer) {
      const rect = S.viewer.scene.canvas.getBoundingClientRect();
      const picked = S.viewer.scene.pick(new Cesium.Cartesian2(e.clientX - rect.left, e.clientY - rect.top));
      if (picked && picked.id && picked.id.__photoIndex !== undefined) return;
    }
    closeLightbox();
  }, true);
}
