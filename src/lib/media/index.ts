/**
 * Browser media utilities. Everything runs client-side; raw video is never uploaded.
 * Safe to import from SSR-rendered client components (no top-level DOM access),
 * but the functions themselves must only be called in the browser.
 */

export { MediaError, VideoDecodeError, VIDEO_DECODE_MESSAGE, IMAGE_DECODE_MESSAGE } from "./errors";
export {
  processImageFile,
  cropImage,
  getImageSize,
  isHeic,
  type ProcessImageOptions,
  type ProcessedImage,
  type CropRect,
} from "./image";
export {
  extractVideoFrames,
  grabFrameAt,
  getVideoDuration,
  computeFrameTimestamps,
  clampFrameCount,
  MIN_FRAMES,
  MAX_FRAMES,
  DEFAULT_FRAMES,
  type VideoFrame,
  type ExtractFramesOptions,
  type GrabFrameOptions,
} from "./video";
export {
  blobToBase64,
  blobToDataUrl,
  estimateBase64Bytes,
  fitImagesToBudget,
  MAX_IMAGES_PER_REQUEST,
  MAX_REQUEST_BYTES,
} from "./encode";
