/**
 * Photo-marker icons, drawn to canvases for use as Cesium billboard images.
 *
 * Each photo renders as a magnifying-glass-style pin: a circular thumbnail lens
 * floating on a short amber stem, anchored (bottom) at the trackpoint so the
 * lens sits ABOVE the spot with the trackpoint dot right below. Co-located
 * photos collapse into one "multiphoto" pin with a count badge.
 */

import { C } from "./colors";
import { MARKER_ASPECT } from "./config";

type Ctx = CanvasRenderingContext2D;

/** The pin's stem: an amber tail tapering from the lens bottom to a point at the
 *  very bottom of the canvas (the billboard's anchor = trackpoint). */
function drawStem(g: Ctx, size: number, H: number, topY: number) {
  const cx = size / 2, tipY = H - 1, halfW = size * 0.11;
  g.beginPath();
  g.moveTo(cx - halfW, topY);
  g.lineTo(cx + halfW, topY);
  g.lineTo(cx, tipY);
  g.closePath();
  g.fillStyle = C.marker; g.fill();
  g.lineWidth = size * 0.03; g.strokeStyle = C.markerInk; g.stroke();
}

/** Single photo: circle-cropped thumbnail lens with an amber ring, on a stem. */
export function circleThumb(url: string, size = 128, ring = 8): Promise<HTMLCanvasElement | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      const H = Math.round(size * MARKER_ASPECT);
      c.width = size; c.height = H;
      const g = c.getContext("2d")!;
      const r = size / 2;
      drawStem(g, size, H, r * 2 - ring - 2);          // tail emerges from the lens bottom
      g.save();                                         // cover-fit photo into the lens
      g.beginPath(); g.arc(r, r, r - ring, 0, 7); g.closePath(); g.clip();
      const s = Math.max(size / img.width, size / img.height);
      const w = img.width * s, h = img.height * s;
      g.drawImage(img, r - w / 2, r - h / 2, w, h);
      g.restore();
      g.beginPath(); g.arc(r, r, r - ring / 2, 0, 7);
      g.lineWidth = ring; g.strokeStyle = C.marker; g.stroke();
      resolve(c);
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Multiphoto pin: the top thumbnail lens with a card peeking behind it and a
 *  count badge, on a stem. */
export function stackThumb(url: string, count: number, size = 128, ring = 8): Promise<HTMLCanvasElement | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      const H = Math.round(size * MARKER_ASPECT);
      c.width = size; c.height = H;
      const g = c.getContext("2d")!;
      const R = size * 0.30;                            // smaller lens so the back card + badge fit
      const front = { x: size / 2, y: size * 0.49 };
      const back = { x: size * 0.63, y: size * 0.36 };  // peeks up-right, kept inside the canvas
      drawStem(g, size, H, front.y + R - ring);         // tail from the front lens bottom
      // back card peeking behind the top photo
      g.beginPath(); g.arc(back.x, back.y, R, 0, 7);
      g.fillStyle = C.cardBack; g.fill();
      g.lineWidth = ring; g.strokeStyle = C.marker; g.stroke();
      // top photo, circle-cropped
      g.save();
      g.beginPath(); g.arc(front.x, front.y, R - ring / 2, 0, 7); g.clip();
      const s = Math.max((2 * R) / img.width, (2 * R) / img.height);   // cover-fit
      const w = img.width * s, h = img.height * s;
      g.drawImage(img, front.x - w / 2, front.y - h / 2, w, h);
      g.restore();
      g.beginPath(); g.arc(front.x, front.y, R - ring / 2, 0, 7);
      g.lineWidth = ring; g.strokeStyle = C.marker; g.stroke();
      // count badge
      const bx = size * 0.74, by = size * 0.68, br = size * 0.17;
      g.beginPath(); g.arc(bx, by, br, 0, 7);
      g.fillStyle = C.marker; g.fill();
      g.lineWidth = 4; g.strokeStyle = C.markerInk; g.stroke();
      g.fillStyle = C.markerInk; g.textAlign = "center"; g.textBaseline = "middle";
      g.font = `bold ${Math.round(br * 1.25)}px "IBM Plex Mono", ui-monospace, monospace`;
      g.fillText(String(count), bx, by + 1);
      resolve(c);
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
