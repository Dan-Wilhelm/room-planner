import "server-only";
import { z } from "zod";

export const DesignRequest = z.object({
  roomName: z.string().max(200),
  room: z.any(),
  inventory: z.array(z.any()).max(200),
  taste: z.any(),
  style: z.object({
    mode: z.enum(["independent", "matchRoom", "inspiration"]),
    otherRoomDesign: z.any().optional(),
    dnas: z.array(z.any()).max(6).optional(),
    elements: z.string().max(500).optional(),
  }),
  idea: z.string().max(2000),
  budget: z.number().nullable(),
  count: z.number().int().min(1).max(3),
  buildOn: z
    .object({
      design: z.any(),
      feedback: z.string().max(2000),
      lockedKeys: z.array(z.string()).max(60),
    })
    .optional(),
});
export type DesignRequest = z.infer<typeof DesignRequest>;

/** Common context for the design call. Room/inventory data are serialized JSON (data, not instructions). */
export function designContext(b: DesignRequest): string[] {
  const parts: string[] = [
    `ROOM "${b.roomName}" (room model JSON):`,
    JSON.stringify(b.room),
    "",
    "INVENTORY (existing furniture; flag keep = must stay in this room, replaceable = may be replaced/removed; roomId null = spare from another room):",
    JSON.stringify(b.inventory),
    "",
    "TASTE (plain-language answers; dontKnow = show clearly different directions):",
    JSON.stringify(b.taste),
    "",
    `STYLE SOURCE: ${b.style.mode}`,
  ];
  if (b.style.mode === "matchRoom") parts.push("Match the style of this design from another room:", JSON.stringify(b.style.otherRoomDesign ?? {}));
  if (b.style.mode === "inspiration") {
    parts.push("Follow these inspiration design DNAs:", JSON.stringify(b.style.dnas ?? []));
    if (b.style.elements) parts.push(`Only use these elements of the inspiration: ${b.style.elements}`);
  }
  parts.push("", `IDEA: ${b.idea || "(none)"}`, `BUDGET (Budget tier, incl. paint + small materials, excl. shipping): ${b.budget != null ? `€${b.budget}` : "none given"}`);
  if (b.buildOn) {
    parts.push(
      "",
      "BUILD ON THIS EXISTING DESIGN — apply the user's feedback and stay close otherwise:",
      JSON.stringify(b.buildOn.design),
      `FEEDBACK: ${b.buildOn.feedback || "(none)"}`,
      `LOCKED (keep these item/slot keys exactly as they are, including their keys): ${JSON.stringify(b.buildOn.lockedKeys)}`,
    );
  }
  return parts;
}
