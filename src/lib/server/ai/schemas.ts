import "server-only";
import { z } from "zod";
import { ITEM_CATEGORIES } from "@/lib/categories";

// Structured-output constraints: every field required, no min/max/maxItems (enforced in code),
// no nullable unions — "none"/"" /0 are used as sentinels instead.

const Category = z.enum(ITEM_CATEGORIES);
/** Free-text variants keep the compiled grammar small for the large design schema (normalized in code). */
const CategoryStr = z.string().describe(`one of: ${ITEM_CATEGORIES.join(", ")}`);
const oneOf = (values: readonly string[]) => z.string().describe(`one of: ${values.join(" | ")}`);
const Confidence = z.enum(["low", "medium", "high"]);

// ---------------------------------------------------------------------------
// A. Room analysis
// ---------------------------------------------------------------------------
export const RoomAnalysisSchema = z.object({
  corners: z.array(z.object({ x: z.number(), y: z.number() })).describe("Clockwise from above, C0 at the south-west-most corner, cm"),
  northAngle: z.number(),
  ceilingHeight: z.number(),
  slopes: z.array(
    z.object({
      wallIndex: z.number().int(),
      kneeWallHeight: z.number(),
      fullHeightDistance: z.number(),
    }),
  ),
  wallFeatures: z.array(
    z.object({
      kind: z.enum(["door", "window", "radiator", "socket", "switch", "connection", "builtIn"]),
      wallIndex: z.number().int(),
      offset: z.number(),
      width: z.number(),
      z: z.number(),
      height: z.number(),
      hinge: z.enum(["start", "end", "none"]),
      opens: z.enum(["inward", "outward", "none"]),
      opening: z.enum(["tilt-turn", "casement", "fixed", "sliding", "other", "none"]),
      depth: z.number().describe("built-ins only, else 0"),
      label: z.string(),
    }),
  ),
  ceilingFeatures: z.array(
    z.object({
      kind: z.enum(["roofWindow", "ceilingLight"]),
      x: z.number(),
      y: z.number(),
      width: z.number(),
      length: z.number(),
      lowerEdgeZ: z.number(),
      typeCode: z.string(),
    }),
  ),
  wallColor: z.string(),
  floorType: z.string(),
  estimates: z
    .array(z.object({ path: z.string(), confidence: Confidence, reason: z.string() }))
    .describe("One entry per value you estimated (not given by the user)"),
  recognizedFurniture: z.array(
    z.object({
      name: z.string(),
      category: Category,
      w: z.number(),
      d: z.number(),
      h: z.number(),
      color: z.string(),
      material: z.string(),
      notes: z.string(),
    }),
  ),
  warnings: z.array(z.string()),
  summary: z.string(),
});
export type RoomAnalysis = z.infer<typeof RoomAnalysisSchema>;

// ---------------------------------------------------------------------------
// B. Design concepts (also used for build-on variations)
// ---------------------------------------------------------------------------
const PlacedItemOut = z.object({
  key: z.string().describe("unique within the design, e.g. 'bed', 'lamp1'"),
  ref: oneOf(["inventory", "slot"]),
  inventoryId: z.string().describe("inventory id for existing items, else ''"),
  slotKey: z.string().describe("slot key for new items, else ''"),
  category: CategoryStr,
  label: z.string(),
  x: z.number(),
  y: z.number(),
  rotation: z.number(),
  w: z.number(),
  d: z.number(),
  h: z.number(),
  z: z.number(),
  mount: oneOf(["floor", "wall", "ceiling", "onTop"]),
  stackedOnKey: z.string().describe("key of the item it stands/lies on, else ''"),
  colorHex: z.string(),
  material: z.string(),
  kelvin: z.number().describe("light sources only, else 0"),
  lumens: z.number().describe("light sources only, else 0"),
});

const SlotOut = z.object({
  key: z.string(),
  placedKey: z.string().describe("key of the placed item, '' for paint/materials/cushions"),
  category: CategoryStr,
  label: z.string(),
  maxW: z.number(),
  maxD: z.number(),
  maxH: z.number(),
  color: z.string(),
  material: z.string(),
  styleTags: z.array(z.string()),
  targetBudget: z.number(),
  targetNicer: z.number(),
  quantity: z.number().int(),
  lookAlike: z.string().describe("visual description if this is a look-alike of an inspiration signature piece, else ''"),
  notes: z.string(),
});

export const DesignOutSchema = z.object({
  name: z.string(),
  summary: z.string(),
  style: z.string(),
  inspirationUse: z.string(),
  approach: oneOf(["close to the inspiration", "inspiration on a budget", "loose interpretation, adapted to this room", "none"]),
  items: z.array(PlacedItemOut),
  removed: z.array(z.object({ inventoryId: z.string(), reason: z.string() })),
  slots: z.array(SlotOut),
  lighting: z.object({
    zones: z.array(z.object({ name: z.string(), kind: oneOf(["ambient", "task", "accent"]), description: z.string() })),
    lights: z.array(
      z.object({
        label: z.string(),
        placedKey: z.string(),
        zone: oneOf(["ambient", "task", "accent"]),
        lumens: z.number(),
        kelvin: z.number(),
        dimmable: z.boolean(),
        base: z.string(),
        bulbIncluded: z.boolean(),
        indirect: z.boolean(),
      }),
    ),
    daylight: z.string(),
  }),
  paint: z.object({
    use: z.boolean(),
    brand: z.string(),
    colorName: z.string(),
    colorCode: z.string(),
    hex: z.string(),
    surfaces: z.array(z.string()),
  }),
  accents: z.array(z.object({ name: z.string(), hex: z.string() })),
  textiles: z.array(z.object({ item: z.string(), detail: z.string() })),
  plantsDecor: z.array(z.object({ item: z.string(), detail: z.string() })),
  whyBetter: z.string(),
});
export type DesignOut = z.infer<typeof DesignOutSchema>;

export const ConceptsSchema = z.object({ designs: z.array(DesignOutSchema) });
export type ConceptsOut = z.infer<typeof ConceptsSchema>;

export const BriefsSchema = z.object({
  briefs: z.array(
    z.object({
      name: z.string(),
      style: z.string().describe("plain words, e.g. light wood, white walls, simple shapes"),
      approach: oneOf(["close to the inspiration", "inspiration on a budget", "loose interpretation, adapted to this room", "none"]),
      layoutIdea: z.string().describe("where the main pieces go and why, 2-3 sentences"),
      palette: z.array(z.string()).describe("3-5 hex colours"),
      keyPieces: z.array(z.string()),
    }),
  ),
});
export type BriefsOut = z.infer<typeof BriefsSchema>;

// ---------------------------------------------------------------------------
// C. Repair
// ---------------------------------------------------------------------------
export const RepairSchema = z.object({
  moves: z.array(z.object({ itemId: z.string(), x: z.number(), y: z.number(), rotation: z.number(), w: z.number(), d: z.number(), h: z.number() })),
  removeItemIds: z.array(z.string()),
  explanation: z.string(),
});
export type RepairOut = z.infer<typeof RepairSchema>;

// ---------------------------------------------------------------------------
// D/G. Products (client tool `submit_products`)
// ---------------------------------------------------------------------------
export const ProductOut = z.object({
  slotKey: z.string(),
  tier: z.enum(["budget", "nicer", "alternative"]),
  rank: z.number().int(),
  name: z.string(),
  shop: z.string(),
  priceEur: z.number(),
  url: z.string(),
  w: z.number().describe("cm, 0 if unknown"),
  d: z.number(),
  h: z.number(),
  dimsVerified: z.boolean(),
  why: z.string(),
  assembly: z.boolean(),
  bulky: z.boolean(),
  pickup: z.boolean(),
  similarity: z.string().describe("look-alikes: what is similar, else ''"),
});
export const SubmitProductsSchema = z.object({ products: z.array(ProductOut), notes: z.string() });
export type SubmitProducts = z.infer<typeof SubmitProductsSchema>;

// ---------------------------------------------------------------------------
// I. Inspiration design DNA
// ---------------------------------------------------------------------------
export const DesignDnaSchema = z.object({
  palette: z.array(z.object({ name: z.string(), hex: z.string() })),
  materials: z.array(z.string()),
  shapes: z.array(z.string()),
  signaturePieces: z.array(z.object({ name: z.string(), description: z.string() })),
  lightingMood: z.string(),
  kelvin: z.number().describe("0 if unclear"),
  textiles: z.array(z.string()),
  plantsDecor: z.array(z.string()),
  layoutIdeas: z.array(z.string()),
  feel: z.string(),
  doesNotTransfer: z.array(z.string()),
});
