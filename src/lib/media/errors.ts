/** Error with a message that can be shown to the user as-is. */
export class MediaError extends Error {
  readonly userMessage: string;

  constructor(userMessage: string, options?: { cause?: unknown; detail?: string }) {
    super(options?.detail ?? userMessage);
    this.name = "MediaError";
    this.userMessage = userMessage;
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

export const VIDEO_DECODE_MESSAGE =
  "This video can't be decoded in this browser (often iPhone HEVC/HDR). Please upload photos or an MP4 instead.";

/** The browser cannot decode the video (codec unsupported, corrupt file, metadata timeout). */
export class VideoDecodeError extends MediaError {
  constructor(options?: { cause?: unknown; detail?: string }) {
    super(VIDEO_DECODE_MESSAGE, options);
    this.name = "VideoDecodeError";
  }
}

export const IMAGE_DECODE_MESSAGE =
  "This image format can't be read in this browser. Please export it as JPEG.";

export function abortError(signal?: AbortSignal): unknown {
  if (signal?.reason !== undefined) return signal.reason;
  if (typeof DOMException !== "undefined") return new DOMException("The operation was aborted.", "AbortError");
  const e = new Error("The operation was aborted.");
  e.name = "AbortError";
  return e;
}
