/**
 * Minimal EXIF reader for JPEG — just the two things the ingest flow needs
 * (design doc §2.1): DateTimeOriginal (to sync a photo onto the track) and, when
 * present, GPS latitude/longitude (to auto-guess the time offset). No external
 * dependency: we walk the APP1/TIFF/IFD structure directly.
 *
 * Only JPEG is handled here. PNG has no capture time and HEIC needs a full BMFF
 * parser; both fall back to "no metadata" and rely on manual sync.
 */

export type PhotoMeta = {
  /** Capture instant in epoch ms, read as if the camera clock were UTC (EXIF
   *  carries no zone). The sync offset corrects for the real timezone/drift. */
  timeMs: number | null;
  lat: number | null;
  lon: number | null;
};

export async function readPhotoMeta(file: File): Promise<PhotoMeta> {
  const empty: PhotoMeta = { timeMs: null, lat: null, lon: null };
  if (!/jpe?g$/i.test(file.name) && file.type !== "image/jpeg") return empty;
  try {
    // EXIF lives in the first APP1 segment, comfortably inside the first 128 KB.
    const buf = await file.slice(0, 128 * 1024).arrayBuffer();
    return parseExif(new DataView(buf)) ?? empty;
  } catch {
    return empty;
  }
}

function parseExif(v: DataView): PhotoMeta | null {
  if (v.getUint16(0) !== 0xffd8) return null;            // not a JPEG
  let p = 2;
  // Scan JPEG marker segments for APP1 (0xFFE1) carrying "Exif\0\0".
  while (p + 4 < v.byteLength) {
    if (v.getUint8(p) !== 0xff) break;
    const marker = v.getUint8(p + 1);
    const len = v.getUint16(p + 2);
    if (marker === 0xe1 && v.getUint32(p + 4) === 0x45786966) {   // "Exif"
      return readTiff(v, p + 10);                        // TIFF header after "Exif\0\0"
    }
    if (marker === 0xda) break;                          // start of scan: no more headers
    p += 2 + len;
  }
  return null;
}

function readTiff(v: DataView, tiff: number): PhotoMeta {
  const le = v.getUint16(tiff) === 0x4949;               // "II" little-endian, else "MM"
  const u16 = (o: number) => v.getUint16(o, le);
  const u32 = (o: number) => v.getUint32(o, le);

  const out: PhotoMeta = { timeMs: null, lat: null, lon: null };
  const ifd0 = tiff + u32(tiff + 4);

  // Read one IFD, returning any sub-IFD pointers we care about.
  const readIFD = (ifd: number, tags: Record<number, (o: number, type: number, count: number) => void>) => {
    if (ifd + 2 > v.byteLength) return;
    const n = u16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (e + 12 > v.byteLength) return;
      const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
      const valOff = count * typeSize(type) > 4 ? tiff + u32(e + 8) : e + 8;
      tags[tag]?.(valOff, type, count);
    }
  };

  const ascii = (o: number, count: number) => {
    let s = "";
    for (let i = 0; i < count - 1 && o + i < v.byteLength; i++) s += String.fromCharCode(v.getUint8(o + i));
    return s;
  };
  const rational = (o: number) => u32(o) / (u32(o + 4) || 1);

  let exifIFD = 0, gpsIFD = 0;
  readIFD(ifd0, {
    0x8769: (o) => { exifIFD = tiff + u32(o); },          // Exif sub-IFD pointer
    0x8825: (o) => { gpsIFD = tiff + u32(o); },           // GPS sub-IFD pointer
  });

  if (exifIFD) readIFD(exifIFD, {
    0x9003: (o, _t, count) => { out.timeMs = exifDateToMs(ascii(o, count)); },   // DateTimeOriginal
  });

  if (gpsIFD) {
    let latRef = "N", lonRef = "E", lat = NaN, lon = NaN;
    readIFD(gpsIFD, {
      0x0001: (o) => { latRef = String.fromCharCode(v.getUint8(o)); },
      0x0002: (o) => { lat = rational(o) + rational(o + 8) / 60 + rational(o + 16) / 3600; },
      0x0003: (o) => { lonRef = String.fromCharCode(v.getUint8(o)); },
      0x0004: (o) => { lon = rational(o) + rational(o + 8) / 60 + rational(o + 16) / 3600; },
    });
    if (Number.isFinite(lat)) out.lat = latRef === "S" ? -lat : lat;
    if (Number.isFinite(lon)) out.lon = lonRef === "W" ? -lon : lon;
  }
  return out;
}

function typeSize(type: number): number {
  return { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }[type] ?? 1;
}

/** EXIF "YYYY:MM:DD HH:MM:SS" → epoch ms, treated as UTC (no zone in EXIF). */
function exifDateToMs(s: string): number | null {
  const m = s.match(/(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}
