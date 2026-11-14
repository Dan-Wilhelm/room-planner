/**
 * Image processing in the browser: HEIC conversion, orientation, downscaling,
 * JPEG re-encoding and cropping.
 *
 * Privacy: every image is decoded and re-drawn onto a canvas, then encoded as a
 * fresh JPEG. Canvas encoding writes no metadata, so EXIF data (GPS location,
 * camera serial, timestamps) is stripped intentionally. The orientation is
 * applied while decoding ("from-image"), so the pixels end up upright and no
 * EXIF orientation tag is needed afterwards.
 */

import { canvasToJpeg, DEFAULT_MAX_EDGE, DEFAULT_QUALITY, drawScaled, fitSize } from "./canvas";
import { IMAGE_DECODE_MESSAGE, MediaError } from "./errors";

export interface ProcessImageOptions {
  /** Long edge in px after downscaling (default 1280). */
  maxEdge?: number;
  /** JPEG quality 0–1 (default 0.8). */
  quality?: number;
}

export interface ProcessedImage {
  blob: Blob;
  width: number;
  height: number;
}

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ---------------------------------------------------------------------------
// HEIC detection / conversion
// ---------------------------------------------------------------------------

const HEIC_MIME = new Set(["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"]);
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);

/** True if the blob is (very likely) HEIC/HEIF — by MIME type, file extension or magic bytes. */
export async function isHeic(file: Blob): Promise<boolean> {
  const type = (file.type || "").toLowerCase();
  if (HEIC_MIME.has(type)) return true;
  const name = typeof (file as File).name === "string" ? (file as File).name.toLowerCase() : "";
  if (/\.(heic|heif)$/.test(name)) return true;
  // Magic bytes: ISO-BMFF "ftyp" box at offset 4, major brand at offset 8.
  try {
    const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
    if (head.length < 12) return false;
    const ascii = (from: number, to: number) => String.fromCharCode(...head.subarray(from, to));
    if (ascii(4, 8) !== "ftyp") return false;
    const major = ascii(8, 12);
    if (!HEIC_BRANDS.has(major)) return false;
    if (major === "mif1" || major === "msf1") {
      // "mif1" is also used by AVIF; check the compatible brands list.
      const boxSize = (head[0] << 24) | (head[1] << 16) | (head[2] << 8) | head[3];
      const end = Math.min(head.length, boxSize > 0 ? boxSize : head.length);
      for (let i = 16; i + 4 <= end; i += 4) {
        const brand = ascii(i, i + 4);
        if (brand === "avif" || brand === "avis") return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

async function convertHeicToJpeg(blob: Blob): Promise<Blob> {
  const heic2any = (await import("heic2any")).default;
  const result = await heic2any({ blob, toType: "image/jpeg", quality: 0.92 });
  const out = Array.isArray(result) ? result[0] : result;
  if (!out) throw new Error("HEIC conversion returned no image.");
  return out;
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

function decodeWithImageElement(blob: Blob): Promise<Decoded> {
  if (typeof document === "undefined" || typeof Image === "undefined") {
    return Promise.reject(new Error("No DOM image decoder available."));
  }
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.decoding = "async";
  return new Promise<Decoded>((resolve, reject) => {
    img.onload = () => {
      // <img> applies EXIF orientation by default (CSS image-orientation: from-image).
      resolve({
        source: img,
        width: img.naturalWidth,
        height: img.naturalHeight,
        close: () => URL.revokeObjectURL(url),
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image element could not decode the file."));
    };
    img.src = url;
  });
}

async function decodeImage(blob: Blob): Promise<Decoded> {
  const errors: unknown[] = [];
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch (e) {
      errors.push(e);
    }
  }
  try {
    return await decodeWithImageElement(blob);
  } catch (e) {
    errors.push(e);
  }
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(blob);
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch (e) {
      errors.push(e);
    }
  }
  throw new MediaError(IMAGE_DECODE_MESSAGE, { cause: errors[0], detail: "Image decode failed" });
}

/** Decodes any supported image (HEIC included) with EXIF orientation applied. */
async function decodeAny(file: Blob): Promise<Decoded> {
  if (await isHeic(file)) {
    let jpeg: Blob | null = null;
    try {
      jpeg = await convertHeicToJpeg(file);
    } catch (e) {
      // heic2any fails on some newer iPhone files; Safari can decode HEIC natively.
      try {
        return await decodeImage(file);
      } catch {
        throw new MediaError(IMAGE_DECODE_MESSAGE, { cause: e, detail: "HEIC conversion failed" });
      }
    }
    return decodeImage(jpeg);
  }
  return decodeImage(file);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Converts any photo (JPEG, PNG, WebP, HEIC/HEIF, …) into an upright JPEG whose
 * long edge is ≤ maxEdge. EXIF/GPS metadata is stripped by the re-encode.
 */
export async function processImageFile(file: File | Blob, opts: ProcessImageOptions = {}): Promise<ProcessedImage> {
  const maxEdge = opts.maxEdge ?? DEFAULT_MAX_EDGE;
  const quality = opts.quality ?? DEFAULT_QUALITY;
  let decoded: Decoded | null = null;
  try {
    decoded = await decodeAny(file);
    if (!decoded.width || !decoded.height) {
      throw new MediaError(IMAGE_DECODE_MESSAGE, { detail: "Decoded image has zero size" });
    }
    const { width, height } = fitSize(decoded.width, decoded.height, maxEdge);
    const { canvas } = drawScaled(
      decoded.source,
      { sx: 0, sy: 0, sw: decoded.width, sh: decoded.height },
      width,
      height,
    );
    const blob = await canvasToJpeg(canvas, quality);
    return { blob, width, height };
  } catch (e) {
    if (e instanceof MediaError) throw e;
    throw new MediaError(IMAGE_DECODE_MESSAGE, { cause: e, detail: "Image processing failed" });
  } finally {
    decoded?.close();
  }
}

/**
 * Crops `rect` (in pixels of the upright source image) out of `blob` and returns
 * a JPEG. The result is additionally limited to maxEdge (default 1280).
 */
export async function cropImage(
  blob: Blob,
  rect: CropRect,
  opts: ProcessImageOptions = {},
): Promise<Blob> {
  const maxEdge = opts.maxEdge ?? DEFAULT_MAX_EDGE;
  const quality = opts.quality ?? 0.85;
  let decoded: Decoded | null = null;
  try {
    decoded = await decodeAny(blob);
    const x = Math.max(0, Math.min(decoded.width - 1, Math.round(rect.x)));
    const y = Math.max(0, Math.min(decoded.height - 1, Math.round(rect.y)));
    const w = Math.max(1, Math.min(decoded.width - x, Math.round(rect.w)));
    const h = Math.max(1, Math.min(decoded.height - y, Math.round(rect.h)));
    const size = fitSize(w, h, maxEdge);
    const { canvas } = drawScaled(decoded.source, { sx: x, sy: y, sw: w, sh: h }, size.width, size.height);
    return await canvasToJpeg(canvas, quality);
  } catch (e) {
    if (e instanceof MediaError) throw e;
    throw new MediaError("This image couldn't be cropped. Please try another photo.", { cause: e });
  } finally {
    decoded?.close();
  }
}

/** Reads the pixel size of an image blob (orientation applied). */
export async function getImageSize(blob: Blob): Promise<{ width: number; height: number }> {
  const decoded = await decodeAny(blob);
  try {
    return { width: decoded.width, height: decoded.height };
  } finally {
    decoded.close();
  }
}
