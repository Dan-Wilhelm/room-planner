import "server-only";

export { isBlockedAddress } from "./ip";
export {
  safeFetch,
  safeFetchBinary,
  parseFetchableUrl,
  resolveSafeAddresses,
  BROWSER_USER_AGENT,
  MAX_PROXY_BYTES,
  type SafeFetchOptions,
  type SafeFetchResult,
  type SafeFetchBinaryResult,
  type SafeFetchError,
} from "./safe-fetch";
export {
  parseOpenGraph,
  decodeHtmlEntities,
  parseAttributes,
  collectMeta,
  extractTitleTag,
  type OpenGraphData,
} from "./opengraph";
export { detectPlatform, parseInstagramUrl, type Platform, type InstagramUrlInfo } from "./platform";
export {
  checkProductLink,
  classifyLinkResponse,
  looksLikeBotWall,
  isSearchOrCategoryUrl,
  isHomepageUrl,
  visibleText,
  type LinkCheckResult,
  type LinkCheckStatus,
  type ClassifyInput,
} from "./link-check";
export {
  fetchLinkPreview,
  instagramBoosterStatus,
  captionFromOEmbedHtml,
  htmlToText,
  type LinkPreview,
  type InstagramBoosterStatus,
} from "./preview";
