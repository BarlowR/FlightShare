/**
 * The photo panel (half-screen, non-modal). Opening a photo sweeps the flight
 * to where it was taken and, when several photos share a spot, shows a strip of
 * the co-located thumbnails to browse.
 */

import { S } from "./state";
import { $, fmtUTC } from "./util";
import { setPlaying, scrubTo } from "./playback";
import { applyPanOffset } from "./camera";

/** In free-orbit mode, fly the globe to a photo/note location, then pan it into
 *  the area the panel leaves free. No-op in follow mode (the scrub drives the
 *  camera there instead). */
function flyToSpot(lon: number, lat: number, alt: number) {
  if (!S.viewer || S.cameraMode !== "free") return;
  const pos = Cesium.Cartesian3.fromDegrees(lon, lat, alt);
  S.viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(pos, 500), {
    duration: 1.1,
    offset: new Cesium.HeadingPitchRange(
      Cesium.Math.toRadians(-35), Cesium.Math.toRadians(-22), 2400),
    complete: applyPanOffset,
  });
}

/** Point S.lbPos at the timeline entry for the item being opened, so the
 *  shared count/dots and arrow/swipe stepping stay in sync no matter how the
 *  item was opened (marker, dot, strip, or navigation). */
function syncPos(kind: "photo" | "note", idx: number) {
  const p = S.timeline.findIndex(e => e.kind === kind && e.idx === idx);
  if (p >= 0) S.lbPos = p;
}

/** Pagination dots: one per stop in the merged photo+annotation timeline, the
 *  current one highlighted. Note stops get a `note` modifier so they read as a
 *  different kind of marker. Rebuilt only when the count changes. */
function renderDots() {
  const dots = $("lbDots");
  if (dots.childElementCount !== S.timeline.length) {
    dots.innerHTML = "";
    S.timeline.forEach((e, k) => {
      const d = document.createElement("button");
      d.setAttribute("role", "tab");
      if (e.kind === "note") {
        d.className = "note";
        d.setAttribute("aria-label", `Note ${k + 1}: ${S.ANNOTATIONS[e.idx].text}`);
        d.addEventListener("click", () => openAnnotation(e.idx));
      } else {
        d.setAttribute("aria-label", `Photo ${k + 1}: ${S.PHOTOS[e.idx].caption}`);
        d.addEventListener("click", () => openLightbox(e.idx));
      }
      dots.appendChild(d);
    });
  }
  for (let k = 0; k < dots.children.length; k++) {
    dots.children[k].setAttribute("aria-current", String(k === S.lbPos));
  }
  dots.style.display = "";
}

export function openLightbox(i: number) {
  S.lbIndex = (i + S.PHOTOS.length) % S.PHOTOS.length;
  syncPos("photo", S.lbIndex);
  const ph = S.PHOTOS[S.lbIndex];
  S.lbTPos = ph.tPos;                   // for the onTick scrub-away auto-close
  $("lightbox").classList.remove("note");   // full photo panel
  $("lbImg").style.display = "";        // (restore after an annotation was shown)
  $("lbNote").style.display = "none";
  $("lbImg").src = ph.img;
  $("lbImg").alt = ph.caption;
  $("lbCaption").textContent = ph.caption;
  $("lbTime").textContent = fmtUTC(ph.t);
  $("lbAlt").textContent = Math.round(ph.alt) + " m";
  $("lbCount").textContent = `${S.lbPos + 1} of ${S.timeline.length}`;

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

  renderDots();

  $("lightbox").classList.add("open");
  setPlaying(false);

  /* sweep the flight to where this photo was taken. In follow mode those ticks
     also pan the view into the free area (applyPanOffset). */
  scrubTo(ph.tPos);

  flyToSpot(ph.lon, ph.lat, ph.alt);
}

/** Open a text annotation in the same panel: no image, the note shown large,
 *  with its time + altitude. Photo dots / group strip are hidden. */
export function openAnnotation(i: number) {
  const n = S.ANNOTATIONS.length;
  if (!n) return;
  S.lbAnnot = (i + n) % n;
  syncPos("note", S.lbAnnot);
  const a = S.ANNOTATIONS[S.lbAnnot];
  S.lbTPos = a.tPos;                    // for the onTick scrub-away auto-close

  $("lightbox").classList.add("note");   // compact, fit-to-content card
  $("lbImg").style.display = "none";
  const note = $("lbNote");
  note.style.display = "";
  note.textContent = a.text || "…";
  $("lbCaption").textContent = "";
  $("lbTime").textContent = fmtUTC(a.t);
  $("lbAlt").textContent = Math.round(a.alt) + " m";
  $("lbCount").textContent = `${S.lbPos + 1} of ${S.timeline.length}`;
  $("lbSpot").style.display = "none";
  $("lbStrip").style.display = "none";
  renderDots();          // same combined strip as the photo view

  $("lightbox").classList.add("open");
  setPlaying(false);
  scrubTo(a.tPos);
  flyToSpot(a.lon, a.lat, a.alt);
}

export function closeLightbox() {
  $("lightbox").classList.remove("open");
}

/** Step the panel by ±1 through the merged photo+annotation timeline, wrapping
 *  at the ends. Used by arrows and swipe. */
export function stepLightbox(dir: number) {
  const n = S.timeline.length;
  if (!n) return;
  const e = S.timeline[(S.lbPos + dir + n) % n];
  if (e.kind === "note") openAnnotation(e.idx);
  else openLightbox(e.idx);
}

/** Horizontal swipe on the photo (or note) → previous/next. Call once at
 *  startup. */
export function initLightboxGestures() {
  let x0 = 0, y0 = 0, active = false;
  const onDown = (e: PointerEvent) => { active = true; x0 = e.clientX; y0 = e.clientY; };
  const onUp = (e: PointerEvent) => {
    if (!active) return;
    active = false;
    const dx = e.clientX - x0, dy = e.clientY - y0;
    // mostly-horizontal drag past a threshold: swipe left = next, right = prev
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      stepLightbox(dx < 0 ? 1 : -1);
    }
  };
  // bind to both the photo and the text-note surface so swiping works in either
  for (const el of [$("lbImg"), $("lbNote")]) {
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", () => { active = false; });
    el.addEventListener("dragstart", (e: Event) => e.preventDefault());
  }

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
      const id = S.viewer.scene.pick(new Cesium.Cartesian2(e.clientX - rect.left, e.clientY - rect.top))?.id;
      if (id && (id.__photoIndex !== undefined || id.__annotIndex !== undefined)) return;
    }
    closeLightbox();
  }, true);
}
