/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

// CesiumJS is loaded from a CDN as a global (see src/pages/index.astro), not
// bundled, so the viewer modules reference it as an ambient `any`.
declare const Cesium: any;

interface Window {
  Cesium: any;
  CESIUM_BASE_URL: string;
  __cesiumReady: Promise<void>;
}

interface ImportMetaEnv {
  readonly PUBLIC_CESIUM_ION_TOKEN?: string;
  readonly PUBLIC_FLIGHT_URL?: string;
}
