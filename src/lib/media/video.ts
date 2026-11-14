/**
 * Video frame extraction in the browser. The raw video never leaves the device:
 * it is played from an object URL (streamed from disk, never read into memory
 * as a whole), seeked to a few timestamps and each frame is drawn onto a canvas
 * and encoded as a downscaled JPEG.
 */

import { canvasToJpeg, DEFAULT_MAX_EDGE, DEFAULT_QUALITY, drawScaled, fitSize } from "./canvas";
import { abortError, MediaError, VideoDecodeError } from "./errors";

export interface VideoFrame {
  blob: Blob;
  width: number;
  height: number;
  timeSec: number;
}

export interface ExtractFramesOptions {
  /** Number of frames (default 10, clamped to 8–12). */
  count?: number;
  /** Start of the time range in seconds (default 0). */
  from?: number;
  /** End of the time range in seconds (default: video duration). */
  to?: number;
  /** Long edge in px (default 1280). */
  maxEdge?: number;
  /** JPEG quality (default 0.8). */
  quality?: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export interface GrabFrameOptions {
  maxEdge?: number;
  quality?: number;
  signal?: AbortSignal;
}

const METADATA_TIMEOUT_MS = 8000;
const SEEK_TIMEOUT_MS = 10000;
const EDGE_MARGIN_S = 0.05;

export const MIN_FRAMES = 8;
export const MAX_FRAMES = 12;
export const DEFAULT_FRAMES = 10;

/**
 * Evenly spaced timestamps inside [from, to] (centres of `count` equal slices),
 * so neither exactly 0 nor the very last instant is used (those are often black
 * or not decodable).
 */
export function computeFrameTimestamps(duration: number, count: number, from?: number, to?: number): number[] {
  const n = Math.max(1, Math.round(count));
  if (!(duration > 0) || !Number.isFinite(duration)) return Array.from({ length: n }, () => 0);
  const lo = Math.min(Math.max(from ?? 0, 0), duration);
  const hi = Math.min(Math.max(to ?? duration, lo), duration);
  const minT = Math.min(EDGE_MARGIN_S, duration / 2);
  const maxT = Math.max(minT, duration - EDGE_MARGIN_S);
  const span = hi - lo;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = span > 0 ? lo + ((i + 0.5) * span) / n : lo;
    out.push(Math.round(Math.min(maxT, Math.max(minT, t)) * 1000) / 1000);
  }
  return out;
}

export function clampFrameCount(count: number | undefined): number {
  const c = Math.round(count ?? DEFAULT_FRAMES);
  if (!Number.isFinite(c)) return DEFAULT_FRAMES;
  return Math.min(MAX_FRAMES, Math.max(MIN_FRAMES, c));
}

// ---------------------------------------------------------------------------
// Internal video handling
// ---------------------------------------------------------------------------

interface OpenedVideo {
  video: HTMLVideoElement;
  duration: number;
  close: () => void;
}

function waitForEvent(
  target: HTMLVideoElement,
  event: string,
  opts: { timeoutMs: number; signal?: AbortSignal; onTimeout: () => unknown },
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(abortError(opts.signal));
      return;
    }
    const cleanup = () => {
      clearTimeout(timer);
      target.removeEventListener(event, onEvent);
      target.removeEventListener("error", onError);
      opts.signal?.removeEventListener("abort", onAbort);
    };
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new VideoDecodeError({ detail: `Video error (code ${target.error?.code ?? "?"}) while waiting for ${event}` }));
    };
    const onAbort = () => {
      cleanup();
      reject(abortError(opts.signal));
    };
    target.addEventListener(event, onEvent);
    target.addEventListener("error", onError);
    opts.signal?.addEventListener("abort", onAbort);
    // Handlers only run asynchronously, after `timer` is initialised.
    const timer = setTimeout(() => {
      cleanup();
      reject(opts.onTimeout());
    }, opts.timeoutMs);
  });
}

async function openVideo(file: Blob, signal?: AbortSignal): Promise<OpenedVideo> {
  if (typeof document === "undefined") {
    throw new MediaError("Video processing only works in the browser.");
  }
  if (signal?.aborted) throw abortError(signal);

  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.setAttribute("muted", "");
  video.setAttribute("playsinline", "");
  video.setAttribute("aria-hidden", "true");
  // Some browsers (iOS Safari) only decode reliably when the element is in the DOM.
  video.style.cssText =
    "position:fixed;left:-10000px;top:0;width:2px;height:2px;opacity:0;pointer-events:none;";
  document.body.appendChild(video);

  const close = () => {
    try {
      video.pause();
      video.removeAttribute("src");
      video.load();
    } catch {
      // ignore
    }
    video.remove();
    URL.revokeObjectURL(url);
  };

  try {
    const metadata = waitForEvent(video, "loadedmetadata", {
      timeoutMs: METADATA_TIMEOUT_MS,
      signal,
      onTimeout: () => new VideoDecodeError({ detail: "Video metadata did not load in time" }),
    });
    video.src = url;
    await metadata;

    if (!video.videoWidth || !video.videoHeight) {
      throw new VideoDecodeError({ detail: "Video has no decodable picture (videoWidth 0)" });
    }

    let duration = video.duration;
    if (!Number.isFinite(duration)) {
      // Some recordings (e.g. MediaRecorder WebM) report Infinity until the end is seeked.
      const settled = waitForEvent(video, "durationchange", {
        timeoutMs: 3000,
        signal,
        onTimeout: () => new VideoDecodeError({ detail: "Video duration unknown" }),
      }).catch(() => undefined);
      video.currentTime = 1e7;
      await settled;
      duration = video.duration;
      if (!Number.isFinite(duration)) duration = video.currentTime || 0;
      await seekTo(video, 0, signal).catch((e) => {
        if (signal?.aborted) throw e;
      });
    }

    if (video.readyState < 2) {
      // Wait briefly for the first frame; seeking will load data anyway, so a timeout here is not fatal.
      await waitForEvent(video, "loadeddata", {
        timeoutMs: 3000,
        signal,
        onTimeout: () => null,
      }).catch((e) => {
        if (e instanceof VideoDecodeError || (e && (e as Error).name === "AbortError") || signal?.aborted) throw e;
      });
    }

    return { video, duration, close };
  } catch (e) {
    close();
    throw e;
  }
}

async function seekTo(video: HTMLVideoElement, t: number, signal?: AbortSignal): Promise<void> {
  if (Math.abs(video.currentTime - t) < 0.0005 && video.readyState >= 2 && !video.seeking) return;
  const seeked = waitForEvent(video, "seeked", {
    timeoutMs: SEEK_TIMEOUT_MS,
    signal,
    onTimeout: () => new VideoDecodeError({ detail: `Seeking to ${t}s timed out` }),
  });
  video.currentTime = t;
  await seeked;
}

async function captureFrame(video: HTMLVideoElement, maxEdge: number, quality: number): Promise<Omit<VideoFrame, "timeSec">> {
  const { width, height } = fitSize(video.videoWidth, video.videoHeight, maxEdge);
  const { canvas } = drawScaled(video, { sx: 0, sy: 0, sw: video.videoWidth, sh: video.videoHeight }, width, height);
  const blob = await canvasToJpeg(canvas, quality);
  return { blob, width, height };
}

function wrapError(e: unknown, signal?: AbortSignal): unknown {
  if (signal?.aborted) return abortError(signal);
  if (e instanceof MediaError) return e;
  if (e && typeof e === "object" && (e as Error).name === "AbortError") return e;
  return new VideoDecodeError({ cause: e, detail: "Frame extraction failed" });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extracts 8–12 evenly spaced JPEG frames from a video file (optionally limited
 * to [from, to] seconds). Throws VideoDecodeError when the browser can't decode it.
 */
export async function extractVideoFrames(file: File, opts: ExtractFramesOptions = {}): Promise<VideoFrame[]> {
  const count = clampFrameCount(opts.count);
  const maxEdge = opts.maxEdge ?? DEFAULT_MAX_EDGE;
  const quality = opts.quality ?? DEFAULT_QUALITY;
  const { signal, onProgress } = opts;

  let opened: OpenedVideo | null = null;
  try {
    opened = await openVideo(file, signal);
    const times = computeFrameTimestamps(opened.duration, count, opts.from, opts.to);
    const frames: VideoFrame[] = [];
    onProgress?.(0, times.length);
    for (const t of times) {
      if (signal?.aborted) throw abortError(signal);
      await seekTo(opened.video, t, signal);
      const frame = await captureFrame(opened.video, maxEdge, quality);
      frames.push({ ...frame, timeSec: t });
      onProgress?.(frames.length, times.length);
    }
    return frames;
  } catch (e) {
    throw wrapError(e, signal);
  } finally {
    opened?.close();
  }
}

/** Grabs a single JPEG frame at `timeSec` (clamped into the video's duration). */
export async function grabFrameAt(file: File | Blob, timeSec: number, opts: GrabFrameOptions = {}): Promise<VideoFrame> {
  const maxEdge = opts.maxEdge ?? DEFAULT_MAX_EDGE;
  const quality = opts.quality ?? DEFAULT_QUALITY;
  let opened: OpenedVideo | null = null;
  try {
    opened = await openVideo(file, opts.signal);
    const d = opened.duration;
    const minT = Math.min(EDGE_MARGIN_S, d / 2);
    const t = d > 0 ? Math.min(Math.max(timeSec, minT), Math.max(minT, d - EDGE_MARGIN_S)) : 0;
    await seekTo(opened.video, t, opts.signal);
    const frame = await captureFrame(opened.video, maxEdge, quality);
    return { ...frame, timeSec: t };
  } catch (e) {
    throw wrapError(e, opts.signal);
  } finally {
    opened?.close();
  }
}

/** Duration (seconds) of a video file, or throws VideoDecodeError. Useful for range pickers. */
export async function getVideoDuration(file: File | Blob, signal?: AbortSignal): Promise<number> {
  let opened: OpenedVideo | null = null;
  try {
    opened = await openVideo(file, signal);
    return opened.duration;
  } catch (e) {
    throw wrapError(e, signal);
  } finally {
    opened?.close();
  }
}
