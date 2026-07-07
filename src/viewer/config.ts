/** Tunable constants and environment-driven config for the viewer. */

export const RAD = Math.PI / 180;

/** Cesium ion token: from a .env (PUBLIC_CESIUM_ION_TOKEN) or the fallback below.
 *  The gate prompts for one if this is empty and none is entered. */
export const ION_TOKEN: string =
  import.meta.env.PUBLIC_CESIUM_ION_TOKEN ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJjYjcxOTVjMy05NDc5LTQ5NDgtYTc0Zi01YWZlZTk5YWZjYWEiLCJpZCI6NDUyNDkxLCJzdWIiOiJtZXJsaW4tcm9iIiwiaXNzIjoiaHR0cHM6Ly9hcGkuY2VzaXVtLmNvbSIsImF1ZCI6IlNreUxvZyBDbGllbnQiLCJpYXQiOjE3ODM0NTg0NDV9.TpC48MAsvmUESznKARkZG9qfRoLj2klARX628Tw8SyE";

/** Which flight bundle to load (design doc §3.3: flights/{slug}/flight.json).
 *  Precedence: ?flight= query param (a slug, or a full path to a flight.json)
 *  → PUBLIC_FLIGHT_URL env → the demo. The gallery links here as /view?flight=slug. */
function resolveFlightUrl(): string {
  const p = new URLSearchParams(location.search).get("flight");
  if (p) return p.includes("/") ? p : `/flights/${p}/flight.json`;
  return import.meta.env.PUBLIC_FLIGHT_URL || "/flights/demo/flight.json";
}
export const FLIGHT_URL: string = resolveFlightUrl();

/** Photos within this distance on the track collapse into one multiphoto marker. */
export const GROUP_DIST_M = 250;

/** Photo-pin canvas geometry: canvas height / width (room for the stem below the lens). */
export const MARKER_ASPECT = 1.34;

/* ---- follow camera ---- */
export const FOLLOW_RANGE = 8000;         // fallback chase distance (m) if track extent unknown
export const FOLLOW_PITCH = -78 * RAD;    // mostly overhead
export const FOLLOW_TAU = 0.7;            // rubber-band time constant, in real seconds

/* ---- playback speed presets ---- */
export const FAST_PLAYBACK_SEC = 10;      // fastest preset plays the whole flight in ~this many real seconds
export const MAX_MULT = 400;              // …but never exceed this multiplier
export const DEFAULT_PLAYBACK_SEC = 60;   // default preset: whichever plays nearest this many real seconds

export const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
