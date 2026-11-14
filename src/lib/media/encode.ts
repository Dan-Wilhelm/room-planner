/**
 * Base64 helpers and request-size budgeting for images sent to API routes as JSON.
 */

import { processImageFile } from "./image";

/** Max images per AI request. */
export const MAX_IMAGES_PER_REQUEST = 12;
/** Max total (base64-encoded) image bytes per request — stays below the 4.5 MB serverless body limit. */
export const MAX_REQUEST_BYTES = 4_000_000;

/** JSON overhead per image (quotes, keys, media type, commas). */
const PER_IMAGE_OVERHEAD = 200;

/** Base64 of the blob's bytes, without a `data:` prefix. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
  }
  return btoa(binary);
}

/** `data:<type>;base64,<…>` URL of the blob. */
export async function blobToDataUrl(blob: Blob): Promise<string> {
  const type = blob.type || "application/octet-stream";
  return `data:${type};base64,${await blobToBase64(blob)}`;
}

/** Estimated size (bytes) of the blobs once base64-encoded inside a JSON body. */
export function estimateBase64Bytes(blobs: Blob[]): number {
  let total = 0;
  for (const b of blobs) total += Math.ceil(b.size / 3) * 4 + PER_IMAGE_OVERHEAD;
  return total;
}

/** Re-encode steps, tried in order until the batch fits. Each step starts from the originals. */
const BUDGET_STEPS: { quality: number; maxEdge: number }[] = [
  { quality: 0.7, maxEdge: 1280 },
  { quality: 0.6, maxEdge: 1280 },
  { quality: 0.6, maxEdge: 1024 },
  { quality: 0.6, maxEdge: 896 },
  { quality: 0.6, maxEdge: 768 },
  { quality: 0.55, maxEdge: 640 },
  { quality: 0.5, maxEdge: 512 },
];

/**
 * Makes sure the images fit into `maxTotalBytes` once base64-encoded. Returns the
 * input unchanged if it already fits; otherwise re-encodes progressively (lower
 * JPEG quality first, then smaller long edges). If even the smallest step does
 * not fit, the smallest result is returned (best effort) — callers should also
 * limit the image count (MAX_IMAGES_PER_REQUEST).
 */
export async function fitImagesToBudget(blobs: Blob[], maxTotalBytes = MAX_REQUEST_BYTES): Promise<Blob[]> {
  if (estimateBase64Bytes(blobs) <= maxTotalBytes) return blobs;
  let best = blobs;
  let bestSize = estimateBase64Bytes(blobs);
  for (const step of BUDGET_STEPS) {
    const out: Blob[] = [];
    for (const b of blobs) {
      const { blob } = await processImageFile(b, step);
      // Never make an individual image bigger than it was.
      out.push(blob.size < b.size ? blob : b);
    }
    const size = estimateBase64Bytes(out);
    if (size < bestSize) {
      best = out;
      bestSize = size;
    }
    if (size <= maxTotalBytes) return out;
  }
  return best;
}
