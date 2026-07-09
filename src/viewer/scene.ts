/**
 * Scene composition and startup (design doc §5.1): create the Cesium viewer,
 * sample terrain under the track (for tethers + a clear failure toast — the
 * altitudes themselves are real and not re-based), build the altitude-colored
 * track polyline, ground shadow, tethers, glider, and photo pins, then frame
 * the default view and start the clock.
 */

import { S } from "./state";
import { reducedMotion, MARKER_ASPECT } from "./config";
import { $, showToast, rampColor } from "./util";
import { C, readColors } from "./colors";
import { circleThumb, stackThumb, annotationPin } from "./markers";
import { loadBundle } from "./bundle";
import { frameFollow } from "./camera";
import { onTick, drawProfile } from "./playback";
import { openLightbox, openAnnotation } from "./lightbox";

export async function initCesium(token: string) {
  Cesium.Ion.defaultAccessToken = token;
  readColors();   // read the flight-viz colors now that the page's CSS is applied

  await loadBundle();   // fetch flight.json → pts, PHOTOS, stats, card

  const worldTerrain = Cesium.Terrain.fromWorldTerrain();

  const viewer = new Cesium.Viewer("cesiumContainer", {
    terrain: worldTerrain,   // Cesium ion World Terrain
    animation: false, timeline: false, geocoder: false, homeButton: false,
    sceneModePicker: false, baseLayerPicker: false, navigationHelpButton: false,
    fullscreenButton: false, infoBox: false, selectionIndicator: false,
    // off so the translucent pass sorts pins strictly back-to-front by distance
    // (each pin is its own collection/command); OIT would blend them order-free
    orderIndependentTranslucency: false,
  });
  S.viewer = viewer;
  viewer.scene.globe.enableLighting = false;
  viewer.scene.globe.depthTestAgainstTerrain = true;   // let terrain occlude track/glider/photos by depth
  viewer.scene.screenSpaceCameraController.enableCollisionDetection = true;

  /* --- sample real terrain under the track ---
     Recorded GNSS altitudes agree with Cesium World Terrain, so we do NOT
     re-base them. We still sample the ground to draw the vertical tethers and
     the terrain-clamped shadow, and to surface a toast if terrain fails. */
  const terrainProvider = await Promise.race([
    new Promise<any>(resolve => {
      if (worldTerrain.ready) { resolve(worldTerrain.provider); return; }
      const offReady = worldTerrain.readyEvent.addEventListener((p: any) => { offReady(); resolve(p); });
      const offErr = worldTerrain.errorEvent.addEventListener(() => { offErr(); resolve(null); });
    }),
    new Promise<any>(resolve => setTimeout(() => resolve(null), 15000)),  // don't hang forever
  ]);

  const pts = S.pts;
  const SAMPLE_STRIDE = 6;                          // ~12s between real terrain samples
  const sampleIdx: number[] = [];
  for (let i = 0; i < pts.length; i += SAMPLE_STRIDE) sampleIdx.push(i);
  if (sampleIdx[sampleIdx.length - 1] !== pts.length - 1) sampleIdx.push(pts.length - 1);

  let sampled: any = null;
  if (terrainProvider) {
    try {
      const cartos = sampleIdx.map(i => Cesium.Cartographic.fromDegrees(pts[i].lon, pts[i].lat));
      sampled = await Cesium.sampleTerrainMostDetailed(terrainProvider, cartos);
    } catch (e) {
      console.warn("Terrain sampling failed:", e);
      sampled = null;
    }
  }

  const terrainOk = !!sampled &&
    sampled.every((c: any) => c && Number.isFinite(c.height)) &&
    sampled.some((c: any) => Math.abs(c.height) > 5);

  const groundAtSample = terrainOk ? sampled.map((c: any) => c.height) : sampleIdx.map(() => 0);

  if (terrainOk) {
    console.log("Terrain OK — ground at launch:", groundAtSample[0].toFixed(0), "m");
  } else {
    showToast(
      "Terrain elevation couldn't be loaded from Cesium ion — showing the flight above flat ground. " +
      "Check that your token has access to the Cesium World Terrain asset and that " +
      "assets.ion.cesium.com / api.cesium.com aren't blocked by your network.", true);
  }

  if (terrainProvider && terrainProvider.errorEvent) {
    let warned = false;
    terrainProvider.errorEvent.addEventListener(() => {
      if (!warned) { warned = true; console.warn("Some terrain tiles failed to load."); }
    });
  }

  function groundHeightAt(i: number) {
    let lo = 0; while (lo < sampleIdx.length - 1 && sampleIdx[lo + 1] < i) lo++;
    const hi = Math.min(lo + 1, sampleIdx.length - 1);
    const a = sampleIdx[lo], b = sampleIdx[hi];
    const f = b === a ? 0 : (i - a) / (b - a);
    return groundAtSample[lo] + (groundAtSample[hi] - groundAtSample[lo]) * f;
  }

  /* snap any track point that sits below the sampled terrain up onto the
     surface — GNSS altitude noise or a terrain mismatch would otherwise bury
     the track (and the glider following it) underground. Mutating S.pts here
     feeds the corrected altitude to the polyline, glider samples, tethers, and
     telemetry alike. Only when terrain actually loaded; with no ground data
     (groundAtSample all 0) we leave altitudes untouched. */
  const SNAP_OFFSET = 2;   // sit a hair above the surface, not exactly on it
  if (terrainOk) {
    for (let i = 0; i < pts.length; i++) {
      const ground = groundHeightAt(i) + SNAP_OFFSET;
      if (pts[i].alt < ground) pts[i].alt = ground;
    }
  }

  const clock = viewer.clock;
  S.clock = clock;
  clock.startTime = Cesium.JulianDate.fromDate(new Date(S.T0));
  clock.stopTime = Cesium.JulianDate.addSeconds(clock.startTime, S.TOTAL, new Cesium.JulianDate());
  clock.currentTime = clock.startTime.clone();
  clock.clockRange = Cesium.ClockRange.CLAMPED;
  clock.multiplier = S.defaultMult;
  clock.shouldAnimate = false;

  /* glider position over time */
  const posProp = new Cesium.SampledPositionProperty();
  S.posProp = posProp;
  posProp.setInterpolationOptions({
    interpolationDegree: 1,
    interpolationAlgorithm: Cesium.LinearApproximation,
  });
  for (const p of pts) {
    posProp.addSample(
      Cesium.JulianDate.addSeconds(clock.startTime, p.t, new Cesium.JulianDate()),
      Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.alt));
  }

  /* track polyline, colored by altitude */
  const positions: any[] = [], colors: any[] = [];
  for (const p of pts) {
    positions.push(Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.alt));
    const [r, g, b] = rampColor(p.alt);
    colors.push(Cesium.Color.fromBytes(r, g, b, 235));
  }
  viewer.scene.primitives.add(new Cesium.Primitive({
    geometryInstances: new Cesium.GeometryInstance({
      geometry: new Cesium.PolylineGeometry({
        positions, colors, colorsPerVertex: true, width: 3.5,
        vertexFormat: Cesium.PolylineColorAppearance.VERTEX_FORMAT,
      }),
    }),
    appearance: new Cesium.PolylineColorAppearance({
      translucent: false,
      // draw the track over the terrain even where a GPS fix sits slightly below
      // the surface, instead of letting terrain occlude it (depthTest disabled)
      renderState: { depthTest: { enabled: false } },
    }),
    asynchronous: false,
  }));

  /* faint ground shadow of the track, draped on terrain */
  viewer.entities.add({
    polyline: {
      positions: pts.filter((_, i) => i % 5 === 0).map(p => Cesium.Cartesian3.fromDegrees(p.lon, p.lat)),
      clampToGround: true, width: 2,
      material: Cesium.Color.BLACK.withAlpha(0.28),
    },
  });

  /* periodic tether lines anchoring the track to the ground, for depth cues */
  const TETHER_STRIDE = Math.max(1, Math.round(pts.length / 42));
  for (let i = 0; i < pts.length; i += TETHER_STRIDE) {
    const p = pts[i];
    viewer.entities.add({
      polyline: {
        positions: [
          Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.alt),
          Cesium.Cartesian3.fromDegrees(p.lon, p.lat, groundHeightAt(i)),
        ],
        width: 1, material: Cesium.Color.WHITE.withAlpha(0.18),
      },
    });
  }

  /* the glider */
  viewer.entities.add({
    availability: new Cesium.TimeIntervalCollection([
      new Cesium.TimeInterval({ start: clock.startTime, stop: clock.stopTime }),
    ]),
    position: posProp,
    point: {
      pixelSize: 11, color: Cesium.Color.fromCssColorString(C.marker),
      outlineColor: Cesium.Color.fromCssColorString(C.markerInk), outlineWidth: 2.5,
      // always draw the glider over the terrain, even where a GPS fix dips
      // slightly below the surface, instead of being occluded by it
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });

  /* markers = a trackpoint dot (below) + a pin (above). The dots stay as
     depth-tested entities so they hide behind terrain and sit under the pins.
     The pins are magnifying-glass thumbnails (photos) or note icons
     (annotations); they're drawn over the terrain (disableDepthTestDistance:
     Infinity) so a pin is never buried behind a ridge — always visible and
     pickable. That flag disables the depth test, so the depth buffer can't
     order overlapping pins; instead each pin gets its OWN billboard collection
     (one draw command each) and Cesium's translucent pass depth-sorts the
     commands back-to-front, so a nearer pin paints over a farther one. We turn
     order-independent translucency off (set in the Viewer options above) so
     that back-to-front sort is what wins. Sorting is Cesium's job here — no
     per-frame rebuild, so no flicker. */
  type Pin = { pos: any; image: any; px: number; swellAt: number[]; id: any; bb: any };
  const pins: Pin[] = [];

  const dot = (pos: any, id: any) => {
    const ent = viewer.entities.add({
      position: pos,
      point: {                                            // the trackpoint, below the pin
        pixelSize: 7, color: Cesium.Color.fromCssColorString(C.marker),
        outlineColor: Cesium.Color.fromCssColorString(C.markerInk), outlineWidth: 2,
        eyeOffset: new Cesium.Cartesian3(0, 0, -30),      // nudge off the track line it sits on
        // depth-tested (unlike the pin): the dot belongs on the surface, so it
        // stays behind the pins and hides behind terrain instead of floating on top
      },
    });
    Object.assign(ent, id);   // __photoIndex / __annotIndex: clicking the dot works too
  };

  /* photo markers: a magnifying-glass pin per spot (single thumbnail, or a
     stacked "multiphoto" marker with a count). Icons pre-rendered to canvases. */
  const groupIcons = await Promise.all(S.groups.map(g =>
    g.members.length > 1
      ? stackThumb(S.PHOTOS[g.members[0]].thumb, g.members.length)
      : circleThumb(S.PHOTOS[g.members[0]].thumb)));
  S.groups.forEach((g, gi) => {
    const pos = Cesium.Cartesian3.fromDegrees(g.lon, g.lat, g.alt);
    const id = { __photoIndex: g.members[0] };            // click opens the group's first photo
    dot(pos, id);
    pins.push({
      pos, image: groupIcons[gi] || S.PHOTOS[g.members[0]].thumb,
      px: g.members.length > 1 ? 58 : 46,
      swellAt: g.members.map(mi => S.PHOTOS[mi].t),        // swell near ANY member's time
      id, bb: null,
    });
  });

  /* text annotations: a note pin in the same style as the photo pins; clicking
     opens the note in the lightbox. Icon is shared across all annotations. */
  if (S.ANNOTATIONS.length) {
    const annotIcon = annotationPin();
    S.ANNOTATIONS.forEach((a, ai) => {
      const pos = Cesium.Cartesian3.fromDegrees(a.lon, a.lat, a.alt);
      const id = { __annotIndex: ai };
      dot(pos, id);
      pins.push({ pos, image: annotIcon, px: 46, swellAt: [a.tPos], id, bb: null });
    });
  }

  /* one collection per pin (see note above) so the translucent sort orders them */
  for (const p of pins) {
    const coll = viewer.scene.primitives.add(new Cesium.BillboardCollection({ scene: viewer.scene }));
    p.bb = coll.add({
      position: p.pos, image: p.image,
      width: p.px, height: Math.round(p.px * MARKER_ASPECT),
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,       // pin sits ABOVE the trackpoint
      horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
      eyeOffset: new Cesium.Cartesian3(0, 0, -30),
      disableDepthTestDistance: Number.POSITIVE_INFINITY, // always over terrain
      id: p.id,
    });
  }

  /* swell: grow a pin as playback passes it. Just updates each pin's scale in
     place every frame — no add/remove, so nothing flickers. */
  if (pins.length && !reducedMotion) {
    viewer.scene.preRender.addEventListener(() => {
      const t = Cesium.JulianDate.secondsDifference(clock.currentTime, clock.startTime);
      for (const p of pins) {
        const d = Math.min(...p.swellAt.map(tm => Math.abs(t - tm)));
        p.bb.scale = 1 + 0.35 * Math.max(0, 1 - d / 14);
      }
    });
  }

  /* picking: open lightbox on marker click, pointer cursor on hover */
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction((m: any) => {
    const id = viewer.scene.pick(m.position)?.id;
    if (!id) return;
    if (id.__photoIndex !== undefined) openLightbox(id.__photoIndex);
    else if (id.__annotIndex !== undefined) openAnnotation(id.__annotIndex);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  handler.setInputAction((m: any) => {
    const id = viewer.scene.pick(m.endPosition)?.id;
    viewer.scene.canvas.style.cursor =
      id && (id.__photoIndex !== undefined || id.__annotIndex !== undefined) ? "pointer" : "default";
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

  /* initial framing — follow is the default: mostly-overhead, north-up, ~2/3 of
     the track. In free mode, frame the whole track. (Gate is still up.) */
  const sphere = Cesium.BoundingSphere.fromPoints(positions);
  S.trackRadius = sphere.radius;
  if (S.cameraMode === "follow") {
    frameFollow();
  } else {
    viewer.camera.flyToBoundingSphere(sphere, {
      duration: 2.2,
      offset: new Cesium.HeadingPitchRange(
        Cesium.Math.toRadians(-30), Cesium.Math.toRadians(-24), sphere.radius * 3.1),
    });
  }

  clock.onTick.addEventListener(onTick);
  drawProfile(0);

  /* hide the gate once the globe has something to show */
  viewer.scene.globe.tileLoadProgressEvent.addEventListener(function onceLoaded(n: number) {
    if (n === 0) {
      viewer.scene.globe.tileLoadProgressEvent.removeEventListener(onceLoaded);
      $("gate").style.display = "none";
    }
  });
  setTimeout(() => { $("gate").style.display = "none"; }, 9000); // fail-safe
}
