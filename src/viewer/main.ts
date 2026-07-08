/**
 * Viewer entry point: wire the DOM controls, then start Cesium (the ion token
 * is baked into config.ts). Imported once by src/pages/view.astro.
 */

import { S } from "./state";
import { ION_TOKEN } from "./config";
import { $ } from "./util";
import { setPlaying, initProfile } from "./playback";
import { setCameraMode } from "./camera";
import { closeLightbox, initLightboxGestures, stepLightbox } from "./lightbox";
import { initCesium } from "./scene";

/* ---- UI wiring ---- */
initProfile();

$("toastClose").addEventListener("click", () => $("toast").classList.remove("show"));

// collapse/expand the flight card body (mobile header)
$("cardToggle").addEventListener("click", () => {
  const collapsed = $("flightCard").classList.toggle("collapsed");
  $("cardToggle").setAttribute("aria-expanded", String(!collapsed));
});

// expand/collapse the flight description
$("descToggle").addEventListener("click", () => {
  const clamped = $("flightDesc").classList.toggle("clamp");
  $("descToggle").textContent = clamped ? "More" : "Less";
  $("descToggle").setAttribute("aria-expanded", String(!clamped));
});

$("btnPlay").addEventListener("click", () => setPlaying(!S.clock.shouldAnimate));

$("speedSeg").addEventListener("click", (e: MouseEvent) => {
  const b = (e.target as HTMLElement).closest("button"); if (!b) return;
  S.clock.multiplier = Number((b as HTMLElement).dataset.mult);
  for (const x of $("speedSeg").children) x.setAttribute("aria-pressed", String(x === b));
});

$("camSeg").addEventListener("click", (e: MouseEvent) => {
  const b = (e.target as HTMLElement).closest("button"); if (!b) return;
  setCameraMode((b as HTMLElement).dataset.cam as "free" | "follow");
  for (const x of $("camSeg").children) x.setAttribute("aria-pressed", String(x === b));
});

$("lbClose").addEventListener("click", closeLightbox);
initLightboxGestures();   // swipe left/right on the photo → next/prev
// keyboard still navigates (arrows) and closes (Esc); dots + swipe replace the buttons
document.addEventListener("keydown", (e: KeyboardEvent) => {
  if (!$("lightbox").classList.contains("open")) return;
  if (e.key === "Escape") closeLightbox();
  if (e.key === "ArrowLeft") stepLightbox(-1);
  if (e.key === "ArrowRight") stepLightbox(1);
});

/* ---- startup ---- the ion token is baked in (config.ts), so the viewer loads
   straight into the flight, showing errors in the splash if Cesium can't start */
function gateFail(msg: string) {
  $("gateLoading").style.display = "none";
  const e = $("gateErr");
  e.textContent = msg;
  e.classList.add("show");
}

async function start() {
  try {
    await window.__cesiumReady;
  } catch {
    gateFail("Couldn't load the CesiumJS library from its CDN. Check your internet connection or content blocker, then reload.");
    return;
  }
  try {
    await initCesium(ION_TOKEN);
  } catch (err: any) {
    gateFail("Cesium failed to start: " + err.message);
  }
}

start();
