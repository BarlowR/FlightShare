/**
 * Flight-visualization colors.
 *
 * The single source of truth is the CSS :root block (src/styles/global.css) so
 * both the CSS and this code read from one place. `C` mirrors the ones the
 * canvas / Cesium code needs (which can't use CSS variables directly).
 */

export const cssVar = (n: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(n).trim();

export const hexRgb = (h: string): number[] => {
  const n = parseInt(h.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export const C = {
  marker: "", markerInk: "", cardBack: "",
  trackLow: [0, 0, 0] as number[],
  trackHigh: [0, 0, 0] as number[],
};

/**
 * Populate `C` from the :root CSS vars. Called at viewer startup (initCesium),
 * NOT at import time — a bundler / dev server may not have applied the
 * stylesheet yet when this module first evaluates, which would leave every
 * color empty (and the track line black). By startup the CSS is applied, so
 * getComputedStyle returns the real values. `C` stays a single object, so every
 * module that imported it sees the filled-in colors.
 */
export function readColors() {
  C.marker = cssVar("--marker");
  C.markerInk = cssVar("--marker-ink");
  C.cardBack = cssVar("--card-back");
  C.trackLow = hexRgb(cssVar("--track-low"));
  C.trackHigh = hexRgb(cssVar("--track-high"));
}
