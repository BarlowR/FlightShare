/**
 * Edit page controller. Loads a flight — a local draft (?draft=slug), a
 * published bundle (?flight=slug), or an opened flight.json — and lets you edit
 * metadata, captions, the default camera, and photo timing, then re-exports the
 * deployable flights/<slug>/ folder as a ZIP. All in the browser (design doc §1).
 */

import type { Bundle, Draft, Media } from "./bundle";
import { slugify } from "./bundle";
import { interpAt, photoTrackTime, clampToTrack } from "./sync";
import { readPhotoMeta } from "./exif";
import { downscale } from "./image";
import { saveDraft, loadDraft, listDrafts } from "./store";
import { createScrubber, type Scrubber } from "./plots";

const $ = (id: string): any => document.getElementById(id);

type Item = { m: Media; baseT: number; caption: string; thumbUrl: string; webUrl: string; el?: HTMLElement };

let bundle: Bundle | null = null;
let slug = "flight";
let blobs: Record<string, Blob> = {};   // in-bundle path → bytes, for re-export
let items: Item[] = [];
let photoTimes: Record<string, number> = {};   // media id → original EXIF capture ms
const acked = new Set<string>();               // out-of-bounds warnings the user dismissed

init();

async function init() {
  const q = new URLSearchParams(location.search);
  try {
    if (q.get("draft")) await openDraft(q.get("draft")!);
    else if (q.get("flight")) {
      // loading an existing published flight is part of the dev backdoor; the
      // `if (false)` in a prod build lets openPublished tree-shake away entirely
      if (import.meta.env.DEV) await openPublished(q.get("flight")!);
      else throw new Error("Editing existing flights is only available in local development.");
    }
    else await showLoader();
  } catch (e: any) {
    $("loadErr").textContent = e.message;
    $("loadErr").hidden = false;
  }
}

/* ---------------------------------------------------------------- loaders ---- */

async function showLoader() {
  const drafts = await listDrafts().catch(() => [] as Draft[]);
  const list = $("draftList");
  if (drafts.length) {
    list.innerHTML = drafts
      .sort((a, b) => b.updated - a.updated)
      .map((d) => `<button class="chip" data-slug="${d.slug}"><b>${escapeHtml(d.bundle.title)}</b> ${new Date(d.updated).toLocaleDateString()}</button>`)
      .join("");
    list.querySelectorAll("[data-slug]").forEach((b: HTMLButtonElement) =>
      b.addEventListener("click", () => openDraft(b.dataset.slug!).catch(showErr)));
  } else {
    list.innerHTML = `<span class="note">No saved drafts. Start from <a href="/upload" style="color:var(--accent)">a new upload</a>.</span>`;
  }
}
const showErr = (e: any) => { $("loadErr").textContent = e.message; $("loadErr").hidden = false; };

async function openDraft(s: string) {
  const d = await loadDraft(s);
  if (!d) throw new Error(`No draft "${s}" in this browser`);
  slug = d.slug; blobs = d.blobs || {}; photoTimes = d.photoTimes || {};
  loadBundle(d.bundle, (path) => (blobs[path] ? URL.createObjectURL(blobs[path]) : ""));
}

async function openPublished(s: string) {
  const base = s.includes("/") ? s.replace(/[^/]*$/, "") : `/flights/${s}/`;
  const url = s.includes("/") ? s : `${base}flight.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't load ${url} (HTTP ${res.status})`);
  const b: Bundle = await res.json();
  slug = s.includes("/") ? slugify(b.title) : s;
  // pull the media bytes back down so the flight can be re-saved intact
  blobs = {};
  for (const m of b.media) {
    for (const p of [m.web, m.thumb]) {
      try { const r = await fetch(base + p); if (r.ok) blobs[p] = await r.blob(); } catch { /* skip */ }
    }
  }
  loadBundle(b, (path) => (blobs[path] ? URL.createObjectURL(blobs[path]) : base + path));
}

// #jsonDrop is a <label> around #jsonInput, so a click opens the picker
// natively — no manual .click() (that would open it twice).
$("jsonInput").addEventListener("change", async () => {
  const f = ($("jsonInput").files || [])[0];
  if (!f) return;
  try {
    const b: Bundle = JSON.parse(await f.text());
    if (!b.track?.points) throw new Error("Not a flight.json (no track)");
    slug = slugify(b.title || "flight"); blobs = {};
    loadBundle(b, () => "");   // no media bytes available from a lone JSON
    $("status").textContent = "Loaded metadata only — media not included when saving";
  } catch (e: any) { showErr(e); }
});

/* ---------------------------------------------------------------- editor ---- */

function loadBundle(b: Bundle, thumbFor: (path: string) => string) {
  bundle = b;
  $("loader").hidden = true;
  $("editor").hidden = false;
  $("sub").textContent = `Editing “${b.title}”.`;

  $("fTitle").value = b.title || "";
  $("fDate").value = b.date || b.track.t0.slice(0, 10);
  $("fPilot").value = b.pilot || "";
  $("fGlider").value = b.glider || "";
  $("fSite").value = b.site || "";
  $("fDesc").value = b.description || "";
  setCamera(b.settings?.cameraDefault || "follow");

  items = b.media.map((m) => ({ m, baseT: m.t, caption: m.caption || "", thumbUrl: thumbFor(m.thumb), webUrl: thumbFor(m.web) }));
  renderPhotos();
}

/* camera default toggle */
document.querySelectorAll<HTMLButtonElement>("#camSeg button").forEach((b) =>
  b.addEventListener("click", () => setCamera(b.dataset.cam as "free" | "follow")));
function setCamera(cam: "free" | "follow") {
  if (bundle) bundle.settings.cameraDefault = cam;
  document.querySelectorAll<HTMLButtonElement>("#camSeg button").forEach((b) =>
    b.setAttribute("aria-pressed", String(b.dataset.cam === cam)));
}

/* ---- item selection + track scrubber (bottom sheet) ---- */

let selected: Item | null = null;
let scrubber: Scrubber | null = null;

function selectItem(it: Item) {
  selected = it;
  items.forEach((x) => x.el?.classList.toggle("sel", x === it));

  $("scrubTitle").value = it.caption;
  const photo = $("scrubPhoto");
  const src = it.webUrl || it.thumbUrl;
  if (src) { photo.src = src; photo.style.display = ""; } else photo.style.display = "none";
  photo.onclick = () => { if (src) window.open(src, "_blank"); };

  const sheet = $("scrubSheet");
  sheet.hidden = false;

  // the photo's original capture time on the track (EXIF + flight offset), if known
  const ms = photoTimes[it.m.id];
  const origTime = ms != null ? photoTrackTime(bundle!.track, ms, bundle!.settings?.syncOffsetSec || 0) : null;

  scrubber?.destroy();
  scrubber = createScrubber($("planCanvas"), $("altCanvas"), bundle!.track.points, (t) => {
    it.baseT = Math.round(t);
    updateSheetTime(it);
    syncBadges();
  }, origTime);
  requestAnimationFrame(() => {
    scrubber?.relayout();
    document.body.style.paddingBottom = sheet.offsetHeight + "px";   // keep content clear of the sheet
  });
  scrubber.setTime(effT(it));
  updateSheetTime(it);
}

function updateSheetTime(it: Item) {
  const t = effT(it);
  $("scrubTime").textContent = `at ${fmtClock(t)} · ${Math.round(interpAt(bundle!.track, t).alt)} m`;
}

function closeSheet() {
  scrubber?.destroy(); scrubber = null;
  selected = null;
  items.forEach((x) => x.el?.classList.remove("sel"));
  $("scrubSheet").hidden = true;
  document.body.style.paddingBottom = "";
}
$("scrubClose").addEventListener("click", closeSheet);

// the pop-out header edits the selected item's caption; keep the row field in sync
$("scrubTitle").addEventListener("input", (e: any) => {
  if (!selected) return;
  selected.caption = e.target.value;
  const rowInput = selected.el?.querySelector("input") as HTMLInputElement | undefined;
  if (rowInput) rowInput.value = e.target.value;
});

/* add photos to an existing flight. #addPhotoDrop is a <label> wrapping its
   input, so it opens the picker on click — we only wire change + drag/drop. */
$("addPhotoInput").addEventListener("change", (e: any) => { addPhotos(Array.from(e.target.files || [])); e.target.value = ""; });
{
  const drop = $("addPhotoDrop");
  drop.addEventListener("dragover", (e: DragEvent) => { e.preventDefault(); drop.classList.add("drag"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
  drop.addEventListener("drop", (e: DragEvent) => {
    e.preventDefault(); drop.classList.remove("drag");
    addPhotos(Array.from(e.dataTransfer?.files || []));
  });
}

/** Next unused "m<n>" id, so added photos don't collide with existing ones. */
function nextMediaId(): string {
  let max = 0;
  for (const it of items) { const m = /^m(\d+)$/.exec(it.m.id); if (m) max = Math.max(max, +m[1]); }
  return `m${max + 1}`;
}

async function addPhotos(files: File[]) {
  if (!bundle) return;
  const track = bundle.track;
  const last = track.points[track.points.length - 1][0];
  const off = bundle.settings?.syncOffsetSec || 0;   // reuse the flight's solved offset
  const imgs = files.filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png)$/i.test(f.name));

  for (const file of imgs) {
    const id = nextMediaId();
    const m: Media = {
      id, type: "photo", status: "ready", t: Math.round(last / 2), end: null,
      lat: 0, lon: 0, alt: 0, caption: "",
      web: `media/${id}_web.jpg`, thumb: `media/${id}_thumb.jpg`,
    };
    const it: Item = { m, baseT: m.t, caption: "", thumbUrl: "", webUrl: "" };
    items.push(it);
    renderPhotos();                                  // show a busy row immediately
    try {
      const meta = await readPhotoMeta(file);
      const r = await downscale(file);
      blobs[m.web] = r.web; blobs[m.thumb] = r.thumb;
      it.thumbUrl = URL.createObjectURL(r.thumb);
      it.webUrl = URL.createObjectURL(r.web);
      if (meta.timeMs != null) photoTimes[m.id] = meta.timeMs;   // for out-of-bounds flagging
      // place it on the track by its EXIF time (via the flight's offset), else mid-flight
      const raw = meta.timeMs != null ? photoTrackTime(track, meta.timeMs, off) : last / 2;
      const t = clampToTrack(track, raw);
      const pos = interpAt(track, t);
      m.t = it.baseT = Math.round(t);
      m.lat = round(pos.lat, 6); m.lon = round(pos.lon, 6); m.alt = Math.round(pos.alt);
    } catch {
      items = items.filter((x) => x !== it);         // couldn't decode — drop it
      delete blobs[m.web]; delete blobs[m.thumb];
    }
    renderPhotos();
  }
}

function renderPhotos() {
  $("photoCount").textContent = items.length ? `${items.length}` : "none";
  const list = $("photoList");
  list.innerHTML = "";
  for (const it of items) {
    const oob = isOutOfBounds(it) && !acked.has(it.m.id);
    const row = document.createElement("div");
    row.className = "photo" + (it.thumbUrl ? "" : " busy") + (it === selected ? " sel" : "") + (oob ? " warn" : "");
    row.innerHTML = `
      <img class="thumb" alt="" ${it.thumbUrl ? `src="${it.thumbUrl}"` : ""} />
      <div class="body">
        <span class="tag">${escapeHtml(it.m.type || "media")}</span>
        <input type="text" placeholder="Caption" value="${escapeAttr(it.caption)}" />
        <div class="badge"></div>
        ${oob ? `<div class="oob">⚠ This photo's time falls outside the flight. Are you sure this photo is correct?
          <button class="oob-keep">Keep it</button><button class="oob-rm">Remove</button></div>` : ""}
      </div>
      <button class="rm" title="Remove" aria-label="Remove item">✕</button>`;
    row.querySelector("input")!.addEventListener("input", (e: any) => {
      it.caption = e.target.value;
      if (it === selected) $("scrubTitle").value = e.target.value;
    });
    // click the row (but not the caption field, buttons) to scrub its time
    row.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("input, button")) return;
      selectItem(it);
    });
    row.querySelector(".rm")!.addEventListener("click", () => removeItem(it));
    row.querySelector(".oob-rm")?.addEventListener("click", () => removeItem(it));
    row.querySelector(".oob-keep")?.addEventListener("click", () => { acked.add(it.m.id); renderPhotos(); });
    it.el = row;
    list.appendChild(row);
  }
  syncBadges();
}

function removeItem(it: Item) {
  if (it === selected) closeSheet();
  items = items.filter((x) => x !== it);
  renderPhotos();
}

/** The item's time, clamped into the flown window. */
const effT = (it: Item) => {
  const last = bundle!.track.points[bundle!.track.points.length - 1][0];
  return Math.max(0, Math.min(last, it.baseT));
};

/** True when a photo's capture time lands outside the tracklog window — i.e. it
 *  was clamped to an endpoint and is probably from a different flight/time. */
function isOutOfBounds(it: Item): boolean {
  const ms = photoTimes[it.m.id];
  if (ms == null || !bundle) return false;
  const last = bundle.track.points[bundle.track.points.length - 1][0];
  const raw = photoTrackTime(bundle.track, ms, bundle.settings?.syncOffsetSec || 0);
  return raw < -1 || raw > last + 1;
}

function syncBadges() {
  if (!bundle) return;
  for (const it of items) {
    const badge = it.el?.querySelector(".badge") as HTMLElement | undefined;
    if (!badge) continue;
    const t = effT(it);
    badge.textContent = `at ${fmtClock(t)} · ${Math.round(interpAt(bundle.track, t).alt)} m`;
  }
}

/* -------------------------------------------------------------- assemble ---- */

/** Rebuild the Bundle from the current form + photo edits. */
function assemble(): Bundle {
  const b = bundle!;
  const media: Media[] = items.map((it) => {
    const t = effT(it);
    const pos = interpAt(b.track, t);
    return {
      ...it.m, t: Math.round(t), caption: it.caption.trim(),
      lat: round(pos.lat, 6), lon: round(pos.lon, 6), alt: Math.round(pos.alt),
    };
  });
  return {
    ...b,
    title: $("fTitle").value.trim() || b.title,
    date: $("fDate").value || b.date,
    pilot: val("fPilot"), glider: val("fGlider"), site: val("fSite"), description: val("fDesc"),
    media,
    settings: { ...b.settings },
  };
}

$("saveBtn").addEventListener("click", async () => {
  const b = assemble();
  const keep = keptBlobs(b);
  try {
    await saveDraft({ slug, updated: Date.now(), bundle: b, blobs: keep, photoTimes });
    bundle = b;   // edits are now the new baseline
    items.forEach((it) => (it.baseT = it.m.t = b.media.find((m) => m.id === it.m.id)!.t));
    $("status").textContent = "Draft saved";
  } catch (e: any) { $("status").textContent = "Save failed: " + e.message; }
});

// Save the current edits, then open the flight in the 3D viewer. The viewer
// loads the draft (bundle + photo blobs) straight from IndexedDB by slug.
$("viewBtn").addEventListener("click", async () => {
  const b = assemble();
  $("status").textContent = "Saving…";
  try {
    await saveDraft({ slug, updated: Date.now(), bundle: b, blobs: keptBlobs(b), photoTimes });
    bundle = b;
    location.href = `/view?draft=${encodeURIComponent(slug)}`;
  } catch (e: any) { $("status").textContent = "Couldn't open viewer: " + e.message; }
});

// Dev backdoor: write the assembled bundle straight back to a flight folder on
// disk via the File System Access API. Pick the flights/<slug>/ directory when
// prompted; flight.json is overwritten and media/ is (re)written under it. The
// button only exists under `astro dev`, and this whole block is stripped from a
// production build (import.meta.env.DEV is statically false there).
if (import.meta.env.DEV) $("diskBtn")?.addEventListener("click", saveToDisk);
async function saveToDisk() {
  const b = assemble();
  const picker = (window as any).showDirectoryPicker;
  const json = new Blob([JSON.stringify(b, null, 2)], { type: "application/json" });

  if (!picker) {   // unsupported browser — fall back to downloading flight.json
    const url = URL.createObjectURL(json);
    const a = document.createElement("a"); a.href = url; a.download = "flight.json"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    $("status").textContent = "No File System API here — downloaded flight.json instead";
    return;
  }

  try {
    $("status").textContent = `Pick the flights/${slug}/ folder…`;
    const dir = await picker({ mode: "readwrite" });
    await writeFile(dir, "flight.json", json);
    const keep = keptBlobs(b);
    if (Object.keys(keep).length) {
      const media = await dir.getDirectoryHandle("media", { create: true });
      for (const [path, blob] of Object.entries(keep)) await writeFile(media, path.replace(/^media\//, ""), blob);
    }
    bundle = b;
    $("status").textContent = `Saved to “${dir.name}/” — refresh the viewer to see it`;
  } catch (e: any) {
    $("status").textContent = e?.name === "AbortError" ? "" : "Save failed: " + e.message;
  }
}
async function writeFile(dir: any, name: string, data: Blob) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(data); await w.close();
}

/** Blobs still referenced by the assembled bundle (drops removed photos). */
function keptBlobs(b: Bundle): Record<string, Blob> {
  const wanted = new Set<string>();
  b.media.forEach((m) => { wanted.add(m.web); wanted.add(m.thumb); });
  return Object.fromEntries(Object.entries(blobs).filter(([p]) => wanted.has(p)));
}

/* --------------------------------------------------------------- helpers ---- */

const val = (id: string) => $(id).value.trim() || undefined;
const round = (n: number, d: number) => { const f = 10 ** d; return Math.round(n * f) / f; };
const pad = (n: number) => String(Math.floor(n)).padStart(2, "0");
const fmtClock = (t: number) => `${pad(t / 3600)}:${pad((t % 3600) / 60)}:${pad(t % 60)}`;
const escapeAttr = (s: string) => s.replace(/"/g, "&quot;").replace(/</g, "&lt;");
const escapeHtml = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
