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
  marker: cssVar("--marker"),
  markerInk: cssVar("--marker-ink"),
  cardBack: cssVar("--card-back"),
  trackLow: hexRgb(cssVar("--track-low")),
  trackHigh: hexRgb(cssVar("--track-high")),
};
