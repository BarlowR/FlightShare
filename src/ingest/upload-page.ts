/**
 * Upload page controller. Kept deliberately minimal: a title, a tracklog, and
 * photos. Photos are parsed (EXIF), downscaled, and *silently* auto-synced to
 * the track here; captions, timing tweaks, and the rest of the details are all
 * done on the edit page. Everything runs in the browser (design doc §1.1).
 */

import { parseTracklog, type Track } from "./tracklog";
import { DEFAULT_ACTIVITY } from "../shared/activities";
import { readPhotoMeta, type PhotoMeta } from "./exif";
import { downscale } from "./image";
import { fitOffset, photoTrackTime, clampToTrack, interpAt } from "./sync";
import { saveDraft } from "./store";
import { slugify, type Bundle, type Draft, type Media } from "./bundle";

const $ = (id: string): any => document.getElementById(id);

type Item = { id: string; meta: PhotoMeta; web: Blob; thumb: Blob; thumbUrl: string };

let track: Track | null = null;
const items: Item[] = [];
let seq = 0;

/* -------------------------------------------------------------- tracklog ---- */

wireDrop($("trackDrop"), $("trackInput"), (files) => loadTrack(files[0]));

async function loadTrack(file: File | undefined) {
  if (!file) return;
  $("trackErr").hidden = true;
  try {
    track = parseTracklog(file.name, await file.text());
  } catch (e: any) {
    track = null;
    $("trackErr").textContent = e.message;
    $("trackErr").hidden = false;
    $("trackDrop").classList.remove("filled");
    $("trackHint").innerHTML = "Drop an <b>IGC</b> or <b>GPX</b> file, or click to choose";
    return;
  }
  $("trackDrop").classList.add("filled");
  $("trackHint").innerHTML = `<b>${escapeHtml(file.name)}</b> — click to replace`;
  $("metaNote").textContent = "";
}

/* --------------------------------------------------------------- photos ---- */

wireDrop($("photoDrop"), $("photoInput"), addPhotos);

async function addPhotos(files: File[]) {
  const imgs = files.filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png)$/i.test(f.name));
  for (const file of imgs) {
    const item: Item = { id: `m${++seq}`, meta: { timeMs: null, lat: null, lon: null }, web: null!, thumb: null!, thumbUrl: "" };
    items.push(item);
    renderPhotos();                                   // placeholder cell right away
    try {
      item.meta = await readPhotoMeta(file);
      const r = await downscale(file);
      item.web = r.web; item.thumb = r.thumb;
      item.thumbUrl = URL.createObjectURL(r.thumb);
    } catch {
      const idx = items.indexOf(item);
      if (idx >= 0) items.splice(idx, 1);             // drop anything we can't decode
    }
    renderPhotos();
  }
  // keep capture order when photos are timestamped
  items.sort((a, b) => (a.meta.timeMs ?? Infinity) - (b.meta.timeMs ?? Infinity));
  renderPhotos();
}

function renderPhotos() {
  $("photoCount").textContent = items.length ? `${items.length}` : "";
  const list = $("photoList");
  list.innerHTML = "";
  for (const it of items) {
    const cell = document.createElement("div");
    cell.className = "cell" + (it.web ? "" : " busy");
    cell.innerHTML =
      `${it.thumbUrl ? `<img alt="" src="${it.thumbUrl}" />` : ""}` +
      `<button class="rm" title="Remove" aria-label="Remove photo">✕</button>`;
    cell.querySelector(".rm")!.addEventListener("click", () => {
      const idx = items.indexOf(it);
      if (idx >= 0) { if (it.thumbUrl) URL.revokeObjectURL(it.thumbUrl); items.splice(idx, 1); renderPhotos(); }
    });
    list.appendChild(cell);
  }
}

/* -------------------------------------------------------------- continue ---- */

$("continueBtn").addEventListener("click", async () => {
  if (!track) { $("metaNote").textContent = "Add a tracklog first"; return; }
  if (items.some((i) => !i.web)) { $("metaNote").textContent = "…still processing photos"; return; }
  const btn = $("continueBtn"); btn.disabled = true; $("metaNote").textContent = "Saving draft…";

  const date = track.t0.slice(0, 10);
  const title = $("fTitle").value.trim() || `Activity ${date}`;
  const slug = slugify(title);
  const last = track.points[track.points.length - 1][0];

  // silent auto-sync: GPS solve when possible, else fit timestamps into the
  // flight's time window (recovers the camera's timezone offset).
  const offsetSec = fitOffset(track, items.map((i) => i.meta));

  const media: Media[] = items.map((it) => {
    const raw = it.meta.timeMs != null ? photoTrackTime(track!, it.meta.timeMs, offsetSec) : last / 2;
    const t = clampToTrack(track!, raw);
    const pos = interpAt(track!, t);
    return {
      id: it.id, type: "photo", status: "ready", t: Math.round(t), end: null,
      lat: round(pos.lat, 6), lon: round(pos.lon, 6), alt: Math.round(pos.alt),
      caption: "", web: `media/${it.id}_web.jpg`, thumb: `media/${it.id}_thumb.jpg`,
    };
  });

  const bundle: Bundle = {
    version: 1, title, date, activity: DEFAULT_ACTIVITY,
    // name / gear / location come from the IGC headers (person / glider / site,
    // when present) so they arrive pre-filled on the edit page; blank → undefined.
    name: track.meta.pilot, gear: track.meta.glider, location: track.meta.site,
    track: { t0: track.t0, dt: track.dt, points: track.points },
    media,
    settings: { syncOffsetSec: offsetSec, cameraDefault: "follow" },
  };

  const blobs: Record<string, Blob> = {};
  const photoTimes: Record<string, number> = {};
  for (const it of items) {
    blobs[`media/${it.id}_web.jpg`] = it.web;
    blobs[`media/${it.id}_thumb.jpg`] = it.thumb;
    if (it.meta.timeMs != null) photoTimes[it.id] = it.meta.timeMs;   // for out-of-bounds flagging on edit
  }

  const draft: Draft = { slug, updated: Date.now(), bundle, blobs, photoTimes };
  try {
    await saveDraft(draft);
    location.href = `/edit?draft=${encodeURIComponent(slug)}`;
  } catch (e: any) {
    $("metaNote").textContent = "Couldn't save draft: " + e.message;
    btn.disabled = false;
  }
});

const round = (n: number, d: number) => { const f = 10 ** d; return Math.round(n * f) / f; };

/* --------------------------------------------------------------- helpers ---- */

/** Wire a drop-zone <label> + hidden input to a File[] handler. The label
 *  already opens the picker on click, so we must NOT call input.click() too. */
function wireDrop(drop: HTMLElement, input: HTMLInputElement, onFiles: (files: File[]) => void) {
  input.addEventListener("change", () => { onFiles(Array.from(input.files || [])); input.value = ""; });
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("drag"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault(); drop.classList.remove("drag");
    onFiles(Array.from(e.dataTransfer?.files || []));
  });
}

const escapeHtml = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
