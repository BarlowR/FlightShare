/**
 * Activity types and the headline stats each one shows. Shared by the editor
 * (the activity selector) and the viewer (which computes/labels stats to match
 * the chosen activity). Kept free of any single-sport vocabulary.
 */

export type Activity = "run" | "ski" | "paraglide" | "bike" | "other";

/** Order shown in the selector. */
export const ACTIVITIES: { key: Activity; label: string }[] = [
  { key: "run", label: "Run" },
  { key: "ski", label: "Ski" },
  { key: "paraglide", label: "Paraglide" },
  { key: "bike", label: "Bike" },
  { key: "other", label: "Other" },
];

export const ACTIVITY_LABEL: Record<Activity, string> =
  Object.fromEntries(ACTIVITIES.map((a) => [a.key, a.label])) as Record<Activity, string>;

/** Older bundles predate the activity field; they were all paraglides. */
export const DEFAULT_ACTIVITY: Activity = "paraglide";

export function asActivity(v: unknown): Activity {
  return ACTIVITIES.some((a) => a.key === v) ? (v as Activity) : DEFAULT_ACTIVITY;
}

/** The metrics a headline stat tile can show. */
export type StatKey = "duration" | "distance" | "maxAlt" | "gain" | "loss" | "bestClimb";

/** The three headline stats per activity (the viewer renders these in order). */
export const ACTIVITY_STATS: Record<Activity, [StatKey, StatKey, StatKey]> = {
  run:       ["duration", "distance", "gain"],
  bike:      ["duration", "distance", "gain"],
  ski:       ["duration", "distance", "loss"],
  paraglide: ["duration", "maxAlt", "bestClimb"],
  other:     ["duration", "distance", "maxAlt"],
};

/** Live telemetry labels. Vertical air sports keep the "vario" idiom; everything
 *  else gets neutral speed/vertical-rate wording. */
export function telemetryLabels(a: Activity): { speed: string; vert: string } {
  return a === "paraglide"
    ? { speed: "GROUND SPD", vert: "VARIO" }
    : { speed: "SPEED", vert: "VERT" };
}
