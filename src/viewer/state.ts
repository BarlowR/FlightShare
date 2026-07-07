/**
 * Shared, mutable viewer state.
 *
 * The viewer is deliberately framework-light (design doc §3.2, §5): a set of
 * plain modules that coordinate through this single object instead of a store
 * library, so it can be reused verbatim in the standalone export. Import `S`
 * and read/write its fields; every module sees the same live values.
 */

export interface TrackPoint { t: number; lat: number; lon: number; alt: number; }

export interface PhotoGroup {
  lat: number; lon: number; alt: number; t: number;
  members: number[];                 // indices into S.PHOTOS
}

export interface Photo {
  i: number;
  t: number; tPos: number;           // capture time, and that time clamped into the flight window
  lat: number; lon: number; alt: number;
  caption: string;
  img: string; thumb: string;        // resolved URLs
  full?: HTMLImageElement;           // preloaded full-res image
  group?: PhotoGroup;
}

export const S = {
  // Cesium
  viewer: null as any,
  clock: null as any,
  posProp: null as any,

  // camera
  cameraMode: "follow" as "follow" | "free",
  followCenter: null as any,
  followLastMs: 0,
  trackRadius: 0,

  // playback
  defaultMult: 25,
  scrubRAF: 0,
  scrubAnim: false,

  // track + media
  pts: [] as TrackPoint[],
  PHOTOS: [] as Photo[],
  groups: [] as PhotoGroup[],
  T0: 0, DT: 1, TOTAL: 0,
  bundleBase: "",
  flownM: 0, maxAlt: -Infinity, minAlt: Infinity, bestClimb: 0, W: 8,

  // lightbox
  lbIndex: 0,
};
