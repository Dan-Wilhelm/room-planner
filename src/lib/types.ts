/**
 * Room Planner — shared data model.
 *
 * COORDINATE CONVENTIONS (binding for UI, AI and code):
 * - Units: centimetres, integers. Prices: EUR with 2 decimals.
 * - Room outline: polygon of corners C0…Cn listed CLOCKWISE as seen from above.
 *   Wall Wi (1-based, i = 1…n+1) runs from corner C(i-1) to Ci; the last wall closes back to C0.
 *   => wall index i uses corners[(i-1)] -> corners[i % corners.length].
 * - Axes: origin = C0, x points east, y points north (when northAngle = 0).
 *   northAngle = compass bearing (degrees) of the +y axis.
 * - Wall features: offset = distance from the wall's start corner to the feature's nearer edge,
 *   measured along the wall; z = height of the feature's bottom edge above the floor.
 * - Items: x/y = CENTER of the footprint; rotation in degrees, clockwise seen from above,
 *   0 = the item's front faces +y; w = width (along the item's local x), d = depth (local y), h = height.
 * - Every RoomModel has a version; every Design stores the room-model version it was made for.
 * - Estimates: values are plain numbers; their provenance is stored in RoomModel.estimates,
 *   keyed by a field path (see EstimatePath). A missing key means source "user" (or "default"
 *   for template defaults the user never touched).
 */

export type ID = string;

export interface Point {
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// Estimates / provenance
// ---------------------------------------------------------------------------

export type ValueSource = "user" | "estimated" | "default";
export type Confidence = "low" | "medium" | "high";

export interface EstimateInfo {
  source: ValueSource;
  confidence?: Confidence; // required when source === "estimated"
  reason?: string; // short explanation, e.g. "door assumed standard 86 cm leaf"
}

/**
 * Field paths used as keys in RoomModel.estimates, e.g.
 *  "corners.2.x", "ceilingHeight", "slopes.<id>.kneeWallHeight",
 *  "wallFeatures.<id>.width", "ceilingFeatures.<id>.x", "wallColor", "floorType".
 */
export type EstimatePath = string;

// ---------------------------------------------------------------------------
// Room model
// ---------------------------------------------------------------------------

export type WallFeatureKind = "door" | "window" | "radiator" | "socket" | "switch" | "connection" | "builtIn";

export type DoorHinge = "start" | "end"; // which end of the opening (relative to wall direction) carries the hinge
export type DoorOpens = "inward" | "outward";
export type WindowOpening = "tilt-turn" | "casement" | "fixed" | "sliding" | "other";

export interface WallFeature {
  id: ID;
  kind: WallFeatureKind;
  wallIndex: number; // 1-based wall number Wi
  offset: number; // cm from the wall's start corner to the near edge
  width: number; // cm along the wall
  z: number; // cm, bottom edge above floor
  height: number; // cm
  label?: string;
  // door
  hinge?: DoorHinge;
  opens?: DoorOpens;
  // window
  opening?: WindowOpening;
  // connection
  connectionType?: "network" | "tv" | "other";
  // built-in (niche, column, chimney, built-in cupboard) — depth into the room
  depth?: number;
}

export type CeilingFeatureKind = "roofWindow" | "ceilingLight";

export interface CeilingFeature {
  id: ID;
  kind: CeilingFeatureKind;
  x: number; // plan position of the centre
  y: number;
  width?: number; // roof window: width across the slope (cm)
  length?: number; // roof window: length along the slope (cm)
  lowerEdgeZ?: number; // roof window: height of lower edge above floor
  typeCode?: string; // roof window type-plate code, e.g. "GGL MK06"
  label?: string;
}

export interface Slope {
  id: ID;
  wallIndex: number; // the wall the slope starts at
  kneeWallHeight: number; // cm, ceiling height at that wall
  fullHeightDistance: number; // horizontal distance (cm) from that wall to where full ceiling height is reached
}

export type RoomTemplateKind = "rectangle" | "lShape" | "rectNiche" | "uShape" | "custom";

export interface RoomTemplate {
  kind: RoomTemplateKind;
  /** Named parameters in cm, meaning depends on kind (see geometry/templates.ts). */
  params: Record<string, number>;
}

export interface RoomModel {
  version: number;
  corners: Point[]; // clockwise from above
  northAngle: number; // bearing of +y in degrees
  ceilingHeight: number; // base (full) ceiling height in cm
  slopes: Slope[];
  wallFeatures: WallFeature[];
  ceilingFeatures: CeilingFeature[];
  wallColor?: string; // free text or hex
  floorType?: string; // e.g. "oak-look laminate"
  template?: RoomTemplate;
  estimates: Record<EstimatePath, EstimateInfo>;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Categories (used for 3D shapes, rules and product search)
// ---------------------------------------------------------------------------

export type ItemCategory =
  | "bed"
  | "sofa"
  | "armchair"
  | "chair"
  | "desk"
  | "deskChair"
  | "table"
  | "sideTable"
  | "nightstand"
  | "wardrobe"
  | "dresser"
  | "shelf"
  | "tvUnit"
  | "floorLamp"
  | "tableLamp"
  | "pendantLamp"
  | "wallLight"
  | "ledStrip"
  | "rug"
  | "curtain"
  | "blind"
  | "plant"
  | "decor"
  | "mirror"
  | "art"
  | "cushion"
  | "throw"
  | "paint"
  | "material" // primer, tape, roller kit…
  | "other";

export const POWERED_CATEGORIES: ItemCategory[] = ["desk", "tvUnit", "floorLamp", "tableLamp", "ledStrip", "wallLight"];

// ---------------------------------------------------------------------------
// Projects, rooms, inventory, inspirations, media
// ---------------------------------------------------------------------------

export interface Project {
  id: ID;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export type InventoryFlag = "keep" | "replaceable";

export interface InventoryItem {
  id: ID;
  projectId: ID;
  roomId: ID | null; // null = spare
  name: string;
  description?: string;
  category: ItemCategory;
  w: number;
  d: number;
  h: number;
  color?: string;
  material?: string;
  shapeHint?: string; // e.g. "L-shaped sofa", "bed with headboard"
  photoId?: ID; // media id
  flag: InventoryFlag;
  /** Set when a design removed it from its room (it became spare). */
  removedFrom?: { roomId: ID; designId: ID };
}

export type MediaKind = "frame" | "photo" | "furniturePhoto" | "inspiration" | "render" | "screenshot";

export interface MediaRecord {
  id: ID;
  ownerId: ID; // room id, inspiration id, design id or inventory id
  kind: MediaKind;
  blob: Blob; // JPEG, already downscaled (long edge ≤ 1280 px)
  width: number;
  height: number;
  timeSec?: number; // for video frames
  label?: string;
  createdAt: number;
}

export interface Taste {
  colorsLike: string;
  colorsDislike: string;
  wood: "yes" | "a bit" | "no" | null;
  light: "warm" | "neutral" | "cool" | null;
  feel: "cozy" | "airy and calm" | "lively" | null;
  plants: "many" | "a few" | "none" | null;
  dontKnow: boolean; // "I don't know yet — show me different directions"
}

export type StyleSource =
  | { mode: "independent" }
  | { mode: "matchRoom"; roomId: ID; designId: ID }
  | { mode: "inspiration"; inspirationIds: ID[]; elements?: string };

export interface Room {
  id: ID;
  projectId: ID;
  name: string;
  createdAt: number;
  updatedAt: number;
  description: string; // free text description of the room
  model: RoomModel | null;
  modelConfirmed: boolean;
  taste: Taste;
  styleSource: StyleSource;
  idea: string;
  budget: number | null; // EUR, incl. paint + small materials, excl. shipping
  chosenDesignId: ID | null;
  /** Pipeline checkpoint for resume (see lib/pipeline). */
  pipeline?: PipelineCheckpoint;
  /** Furniture recognized by the room analysis — the user confirms it in the furniture step. */
  furnitureSuggestions?: { name: string; category: ItemCategory; w: number; d: number; h: number; color: string; material: string; notes: string }[];
  /** Warnings from the last room analysis (e.g. "no real measurement given"). */
  analysisWarnings?: string[];
  analysisSummary?: string;
}

export type PreviewStatus = "link preview ok" | "cover image only" | "failed → upload needed" | "upload only";

export interface DesignDNA {
  palette: { name: string; hex: string }[];
  materials: string[];
  shapes: string[];
  signaturePieces: { name: string; description: string }[];
  lightingMood: string;
  kelvin: number | null;
  textiles: string[];
  plantsDecor: string[];
  layoutIdeas: string[];
  feel: string;
  doesNotTransfer: string[];
}

export interface Inspiration {
  id: ID;
  projectId: ID;
  url?: string;
  platform: "instagram" | "pinterest" | "tiktok" | "web" | "upload";
  title?: string;
  caption?: string;
  author?: string;
  note: string; // which scene/element is meant
  timeRange?: { from: number; to: number }; // seconds
  previewStatus: PreviewStatus;
  dna: DesignDNA | null;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Designs
// ---------------------------------------------------------------------------

export type Tier = "budget" | "nicer";

export interface PlacedItem {
  id: ID;
  ref: { type: "inventory"; inventoryId: ID } | { type: "slot"; slotId: ID };
  category: ItemCategory;
  label: string;
  x: number; // centre
  y: number;
  rotation: number; // degrees clockwise, 0 = front faces +y
  w: number;
  d: number;
  h: number;
  z?: number; // bottom height for wall-/ceiling-mounted items
  mount?: "floor" | "wall" | "ceiling" | "onTop";
  /** Intentional stacking, e.g. a rug under the bed or a lamp on a table. */
  stackedOn?: ID;
  colorHex?: string;
  material?: string;
  kelvin?: number; // light sources
  lumens?: number;
}

export interface Slot {
  id: ID;
  placedItemId: ID | null; // null for non-placed items (paint, materials, cushions…)
  category: ItemCategory;
  label: string;
  maxW: number;
  maxD: number;
  maxH: number;
  color: string;
  material: string;
  styleTags: string[];
  targetPrice: { budget: number; nicer: number };
  quantity: number;
  lookAlike?: string; // visual description of an inspiration signature piece
  notes?: string;
}

export type LinkStatus = "verified" | "could not verify" | "dead → replaced" | "unchecked";
export type FitLabel = "fits" | "fits if moved" | "doesn't fit";

export interface ProductCandidate {
  id: ID;
  name: string;
  shop: string;
  priceEur: number;
  url: string;
  linkStatus: LinkStatus;
  thumbnailUrl?: string;
  w?: number;
  d?: number;
  h?: number;
  dimsVerified: boolean;
  why: string;
  assembly: boolean;
  bulky: boolean;
  pickup: boolean; // e.g. IKEA Karlsruhe
  foundOn: string; // ISO date
  similarity?: string; // look-alikes: what is similar
  fit?: FitLabel;
  fitReason?: string;
}

export interface SlotProducts {
  budget: ProductCandidate[]; // ranked, up to 3 (+ replacements)
  nicer: ProductCandidate[];
  selected: { budget: number; nicer: number }; // index into the arrays
}

export interface LightSpec {
  label: string;
  placedItemId?: ID;
  zone: "ambient" | "task" | "accent";
  lumens: number;
  kelvin: number;
  dimmable: boolean;
  base: string; // E27, E14, GU10, integrated LED…
  bulbIncluded: boolean;
  indirect: boolean;
}

export interface LightingPlan {
  zones: { name: string; kind: "ambient" | "task" | "accent"; description: string }[];
  lights: LightSpec[];
  daylight: string;
}

export interface PaintSpec {
  brand: string;
  colorName: string;
  colorCode: string;
  hex: string;
  surfaces: string[]; // "W1", "W2", … or "slope:<slopeId>"
}

export interface PaintCalc {
  areaM2: number;
  coats: number;
  coverageM2PerL: number;
  litersNeeded: number;
  buckets: number[]; // e.g. [5, 2.5]
  extras: string[]; // primer, tape, roller kit
}

export interface ColorPlan {
  paint: PaintSpec | null;
  accents: { name: string; hex: string }[];
}

export interface DesignWarning {
  code: string; // e.g. "overlap", "headroom", "walkway", "doorSwing", "radiator", "window", "wallGap", "socket", "outside"
  message: string;
  itemIds: ID[];
  severity: "error" | "warning" | "hint";
}

export interface CostEntry {
  step: string; // "analysis", "concepts", "repair", "products", "alternatives", "buildOn", "inspiration", "image", "convert"
  model?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  searches: number;
  fetches: number;
  images: number;
  usd: number;
  at: number;
  failed?: boolean;
  note?: string;
}

export type DesignStatus = "concept" | "searching" | "ready" | "error";

export interface Design {
  id: ID;
  roomId: ID;
  projectId: ID;
  roomModelVersion: number;
  createdAt: number;
  parentDesignId?: ID; // for "build on this design"
  runId: ID; // pipeline run that created it
  name: string;
  summary: string;
  style: string; // plain words
  inspirationUse?: string; // which inspiration elements were taken over and how
  approach?: "close to the inspiration" | "inspiration on a budget" | "loose interpretation, adapted to this room";
  items: PlacedItem[];
  removed: { inventoryId: ID; reason: string }[];
  slots: Slot[];
  products: Record<ID, SlotProducts>; // by slot id
  lighting: LightingPlan;
  colors: ColorPlan;
  paintCalc: PaintCalc | null;
  textiles: { item: string; detail: string }[];
  plantsDecor: { item: string; detail: string }[];
  whyBetter: string;
  warnings: DesignWarning[];
  status: DesignStatus;
  errorMessage?: string;
  locked: ID[]; // slot ids or placed item ids locked by the user
  bought: Record<ID, boolean>; // shopping list check-offs by slot id
  imageMediaId?: ID;
  costs: CostEntry[];
}

// ---------------------------------------------------------------------------
// Pipeline checkpoints
// ---------------------------------------------------------------------------

export type PipelineStep = "analysis" | "concepts" | "check" | "products" | "final" | "done";

export interface PipelineCheckpoint {
  runId: ID;
  kind: "new" | "buildOn";
  step: PipelineStep;
  designIds: ID[];
  /** Design ids whose product search finished. */
  productsDone: ID[];
  startedAt: number;
  costUsd: number;
  stoppedForBudget?: boolean;
  error?: string;
  /** Concept stage state (resumable): the original request, the design briefs and which are done. */
  request?: unknown;
  briefs?: unknown[];
  briefsDone?: number[];
  briefCosts?: CostEntry[];
  parentId?: ID;
  lockedIds?: ID[];
}

// ---------------------------------------------------------------------------
// Streaming protocol (NDJSON) between API routes and the browser
// ---------------------------------------------------------------------------

export type StreamEvent<T = unknown> =
  | { type: "progress"; message: string; done?: number; total?: number }
  | { type: "heartbeat"; t: number }
  | { type: "cost"; entry: CostEntry }
  | { type: "result"; data: T }
  | { type: "error"; message: string; retryable?: boolean };
