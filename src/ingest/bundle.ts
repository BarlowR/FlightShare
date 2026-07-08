/**
 * Shared shapes for the flight bundle (design doc §3.3) and the in-browser draft
 * that the upload page hands to the edit page. `Bundle` is exactly what the
 * viewer fetches as flight.json; `Draft` wraps it with the photo blobs so the
 * bundle can be previewed and exported without a server.
 */

export type Media = {
  id: string;
  type: "photo" | "annotation";   // (video later — the field is the extension point)
  status: "ready";
  t: number;            // seconds from track.t0 (after sync)
  end: number | null;   // null for photos (video would set a range end)
  lat: number;
  lon: number;
  alt: number;
  caption: string;      // photo caption, or the annotation's text
  web?: string;         // "media/<id>_web.jpg" — photos only
  thumb?: string;       // "media/<id>_thumb.jpg" — photos only
};

export type Bundle = {
  version: 1;
  title: string;
  date: string;         // YYYY-MM-DD
  site?: string;
  pilot?: string;
  glider?: string;
  description?: string;
  track: { t0: string; dt: number; points: [number, number, number, number][] };
  media: Media[];
  settings: { syncOffsetSec: number; cameraDefault: "free" | "follow" };
};

/** A draft carries the bundle plus the actual downscaled image bytes, keyed by
 *  their in-bundle path ("media/m1_web.jpg" → Blob). `photoTimes` is a sidecar
 *  (NOT exported to flight.json) recording each photo's original EXIF capture
 *  time in epoch ms, so the editor can flag photos taken outside the flight. */
export type Draft = {
  slug: string;
  updated: number;
  bundle: Bundle;
  blobs: Record<string, Blob>;
  photoTimes?: Record<string, number>;
};

/** URL-safe slug from a flight title, with a short random suffix so two flights
 *  named the same don't collide. */
export function slugify(title: string): string {
  const base = title.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "flight";
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${base}-${suffix}`;
}
