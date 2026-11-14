/**
 * Canvas helpers shared by image and video processing (browser only).
 * Nothing here touches `document` at module load, so importing is SSR-safe.
 */

export type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
export type AnyContext2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

export const DEFAULT_MAX_EDGE = 1280;
export const DEFAULT_QUALITY = 0.8;

export function createCanvas(width: number, height: number): { canvas: AnyCanvas; ctx: AnyContext2D } {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  if (typeof OffscreenCanvas !== "undefined") {
    try {
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext("2d");
      if (ctx) return { canvas, ctx };
    } catch {
      // fall through to a DOM canvas (older Safari has no 2D OffscreenCanvas)
    }
  }
  if (typeof document === "undefined") {
    throw new Error("No canvas available (not running in a browser).");
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable.");
  return { canvas, ctx };
}

/** Target size so that the long edge is ≤ maxEdge (never upscales). */
export function fitSize(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const long = Math.max(width, height);
  if (!(long > maxEdge)) return { width: Math.round(width), height: Math.round(height) };
  const scale = maxEdge / long;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Draws `source` (sx, sy, sw, sh region) into a new canvas of tw×th.
 * Large reductions are done in halving steps, which looks much better than a
 * single drawImage with a big ratio in some browsers. The background is white
 * because JPEG has no alpha channel (transparent PNGs would otherwise turn black).
 */
export function drawScaled(
  source: CanvasImageSource,
  region: { sx: number; sy: number; sw: number; sh: number },
  tw: number,
  th: number,
): { canvas: AnyCanvas; ctx: AnyContext2D } {
  let src: CanvasImageSource = source;
  let { sx, sy, sw, sh } = region;

  // Step down by halves while the ratio is > 2.
  while (sw / 2 > tw && sh / 2 > th) {
    const hw = Math.max(1, Math.round(sw / 2));
    const hh = Math.max(1, Math.round(sh / 2));
    const step = createCanvas(hw, hh);
    step.ctx.imageSmoothingEnabled = true;
    step.ctx.imageSmoothingQuality = "high";
    step.ctx.drawImage(src, sx, sy, sw, sh, 0, 0, hw, hh);
    src = step.canvas;
    sx = 0;
    sy = 0;
    sw = hw;
    sh = hh;
  }

  const out = createCanvas(tw, th);
  out.ctx.fillStyle = "#ffffff";
  out.ctx.fillRect(0, 0, tw, th);
  out.ctx.imageSmoothingEnabled = true;
  out.ctx.imageSmoothingQuality = "high";
  out.ctx.drawImage(src, sx, sy, sw, sh, 0, 0, tw, th);
  return out;
}

export async function canvasToJpeg(canvas: AnyCanvas, quality: number): Promise<Blob> {
  const q = Math.min(1, Math.max(0.1, quality));
  if (typeof OffscreenCanvas !== "undefined" && canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob({ type: "image/jpeg", quality: q });
  }
  return new Promise<Blob>((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Canvas could not be encoded as JPEG."))),
      "image/jpeg",
      q,
    );
  });
}
