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
