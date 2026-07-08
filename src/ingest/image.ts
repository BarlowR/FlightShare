/**
 * Client-side photo downscaling (design doc §2.1: "all heavy processing happens
 * in the browser; the backend stores only processed, privacy-scrubbed
 * artifacts"). Re-encoding through a canvas strips EXIF as a side effect, so the
 * exported web/thumb JPEGs carry no camera GPS or serial metadata.
 */

export const WEB_MAX = 1600;    // long edge of the full-view photo
export const THUMB_MAX = 320;   // long edge of the dot/lightbox thumbnail

export type Rendition = { web: Blob; thumb: Blob; width: number; height: number };

/** Decode `file`, produce downscaled web + thumb JPEG blobs. */
export async function downscale(file: File): Promise<Rendition> {
  const bmp = await loadBitmap(file);
  try {
    const web = await encode(bmp, WEB_MAX, 0.82);
    const thumb = await encode(bmp, THUMB_MAX, 0.7);
    return { web: web.blob, thumb: thumb.blob, width: web.w, height: web.h };
  } finally {
    bmp.close?.();
  }
}

async function loadBitmap(file: File): Promise<ImageBitmap> {
  // createImageBitmap honors EXIF orientation with imageOrientation:"from-image".
  return createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
}

async function encode(bmp: ImageBitmap, maxEdge: number, quality: number) {
  const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, w, h);
  const blob = await new Promise<Blob>((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/jpeg", quality));
  return { blob, w, h };
}
