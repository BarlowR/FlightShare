// @ts-check
import { defineConfig } from "astro/config";

// Skylog is a static single-page app: one page (the viewer) that fetches a
// flight bundle at runtime. CesiumJS is loaded from a CDN with fallback (see
// src/pages/index.astro), so it is intentionally NOT an npm dependency here.
export default defineConfig({
  // "static" output — the whole app deploys as static files behind a CDN.
  output: "static",
});
