"use client";

import type { ConceptsOut, DesignDnaSchema, RepairOut, RoomAnalysis } from "@/lib/server/ai/schemas";
import type { CheckedProduct } from "@/app/api/ai/products/route";
import type { z } from "zod";
import { compactDesign, designFromOut, tierTotal } from "./designConvert";
import {
  getDesign,
  getRoom,
  listDesigns,
  listInspirations,
  listInventory,
  listMedia,
  newId,
  saveDesign,
  saveInspiration,
  updateDesign,
  updateRoom,
} from "./db";
import { checkDesign, fitProduct, paintCalc } from "./geometry";
import { blobToBase64, fitImagesToBudget, MAX_IMAGES_PER_REQUEST, MAX_REQUEST_BYTES } from "./media";
import { ROOM_RUN_LIMIT_USD } from "./pricing";
import { postStream } from "./stream";
import type {
  CeilingFeature,
  CostEntry,
  Design,
  DesignWarning,
  ID,
  InventoryItem,
  PipelineCheckpoint,
  ProductCandidate,
  Room,
  RoomModel,
  Slot,
  SlotProducts,
  WallFeature,
} from "./types";

export interface RunCallbacks {
  onProgress: (scope: string, message: string) => void;
  onCost?: (entry: CostEntry) => void;
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// A. Room analysis
// ---------------------------------------------------------------------------

export interface AnalysisOutcome {
  recognizedFurniture: RoomAnalysis["recognizedFurniture"];
  warnings: string[];
  summary: string;
  cost: number;
}

/** Paths the user entered (source "user" in estimates). */
export function userPaths(model: RoomModel | null): string[] {
  if (!model) return [];
  return Object.entries(model.estimates)
    .filter(([, e]) => e.source === "user")
    .map(([p]) => p);
}

async function roomImages(roomId: ID): Promise<{ base64: string; label: string }[]> {
  const media = (await listMedia(roomId)).filter((m) => m.kind === "frame" || m.kind === "photo").slice(0, MAX_IMAGES_PER_REQUEST);
  const blobs = await fitImagesToBudget(
    media.map((m) => m.blob),
    MAX_REQUEST_BYTES - 200_000,
  );
  return Promise.all(blobs.map(async (b, i) => ({ base64: await blobToBase64(b), label: media[i].kind === "frame" ? `video frame at ${Math.round(media[i].timeSec ?? 0)} s` : media[i].label || "photo" })));
}

export function mergeAnalysis(known: RoomModel | null, a: RoomAnalysis): RoomModel {
  const up = new Set(userPaths(known));
  const userHas = (prefix: string) => [...up].some((p) => p === prefix || p.startsWith(prefix + "."));
  const estimates: RoomModel["estimates"] = {};

  const slopes = a.slopes.map((s, i) => ({ id: `s${i + 1}`, ...s }));
  const wallFeatures: WallFeature[] = a.wallFeatures.map((f) => ({
    id: newId(),
    kind: f.kind,
    wallIndex: f.wallIndex,
    offset: f.offset,
    width: f.width,
    z: f.z,
    height: f.height,
    hinge: f.hinge === "none" ? undefined : f.hinge,
    opens: f.opens === "none" ? undefined : f.opens,
    opening: f.opening === "none" ? undefined : f.opening,
    depth: f.depth > 0 ? f.depth : undefined,
    label: f.label || undefined,
  }));
  const ceilingFeatures: CeilingFeature[] = a.ceilingFeatures.map((c) => ({
    id: newId(),
    kind: c.kind,
    x: c.x,
    y: c.y,
    width: c.width || undefined,
    length: c.length || undefined,
    lowerEdgeZ: c.lowerEdgeZ || undefined,
    typeCode: c.typeCode || undefined,
  }));
  // Translate index-based estimate paths into id-based ones.
  for (const e of a.estimates) {
    const parts = e.path.split(".");
    let path = e.path;
    if (parts[0] === "slopes" && slopes[Number(parts[1])]) path = ["slopes", slopes[Number(parts[1])].id, ...parts.slice(2)].join(".");
    if (parts[0] === "wallFeatures" && wallFeatures[Number(parts[1])]) path = ["wallFeatures", wallFeatures[Number(parts[1])].id, ...parts.slice(2)].join(".");
    if (parts[0] === "ceilingFeatures" && ceilingFeatures[Number(parts[1])]) path = ["ceilingFeatures", ceilingFeatures[Number(parts[1])].id, ...parts.slice(2)].join(".");
    estimates[path] = { source: "estimated", confidence: e.confidence, reason: e.reason };
  }

  const model: RoomModel = {
    version: (known?.version ?? 0) + 1,
    corners: a.corners.map((c) => ({ x: Math.round(c.x), y: Math.round(c.y) })),
    northAngle: a.northAngle,
    ceilingHeight: Math.round(a.ceilingHeight),
    slopes,
    wallFeatures,
    ceilingFeatures,
    wallColor: a.wallColor,
    floorType: a.floorType,
    // AI-estimated outline: the template parameters no longer describe it → corner table ("custom").
    template: { kind: "custom", params: {} },
    estimates,
    notes: a.summary,
  };

  // User-entered values always win.
  if (known) {
    if (userHas("corners") || userHas("template")) {
      model.corners = known.corners;
      model.template = known.template;
      for (const k of Object.keys(model.estimates)) if (k.startsWith("corners")) delete model.estimates[k];
    }
    for (const key of ["ceilingHeight", "northAngle", "wallColor", "floorType"] as const) {
      if (up.has(key)) {
        (model as unknown as Record<string, unknown>)[key] = known[key];
        delete model.estimates[key];
      }
    }
    if (userHas("slopes") && known.slopes.length) {
      model.slopes = known.slopes;
      for (const k of Object.keys(model.estimates)) if (k.startsWith("slopes")) delete model.estimates[k];
    }
    const userFeatures = known.wallFeatures.filter((f) => userHas(`wallFeatures.${f.id}`));
    if (userFeatures.length) {
      const extra = model.wallFeatures.filter(
        (af) => !userFeatures.some((uf) => uf.kind === af.kind && uf.wallIndex === af.wallIndex && Math.abs(uf.offset - af.offset) < 40),
      );
      model.wallFeatures = [...userFeatures, ...extra];
    }
    const userCeil = known.ceilingFeatures.filter((f) => userHas(`ceilingFeatures.${f.id}`));
    if (userCeil.length) {
      const extra = model.ceilingFeatures.filter((af) => !userCeil.some((uf) => uf.kind === af.kind && Math.hypot(uf.x - af.x, uf.y - af.y) < 50));
      model.ceilingFeatures = [...userCeil, ...extra];
    }
    for (const p of up) model.estimates[p] = { source: "user" };
  }
  // Round estimates to 5 cm where they are lengths.
  return model;
}

export async function runAnalysis(roomId: ID, cb: RunCallbacks): Promise<AnalysisOutcome> {
  const room = await getRoom(roomId);
  if (!room) throw new Error("Room not found");
  cb.onProgress("analysis", "Preparing images…");
  const images = await roomImages(roomId);
  let cost = 0;
  const a = await postStream<RoomAnalysis>(
    "/api/ai/analyze",
    { roomName: room.name, description: room.description, known: room.model, userPaths: userPaths(room.model), images },
    {
      signal: cb.signal,
      onProgress: (m) => cb.onProgress("analysis", m),
      onCost: (e) => {
        cost += e.usd;
        cb.onCost?.(e);
      },
    },
  );
  const model = mergeAnalysis(room.model, a);
  await updateRoom(roomId, {
    model,
    modelConfirmed: false,
    furnitureSuggestions: a.recognizedFurniture,
    analysisWarnings: a.warnings,
    analysisSummary: a.summary,
  });
  return { recognizedFurniture: a.recognizedFurniture, warnings: a.warnings, summary: a.summary, cost };
}

// ---------------------------------------------------------------------------
// I. Inspiration analysis
// ---------------------------------------------------------------------------
export async function runInspiration(inspirationId: ID, projectId: ID, cb: RunCallbacks): Promise<number> {
  const insp = (await listInspirations(projectId)).find((i) => i.id === inspirationId);
  if (!insp) throw new Error("Inspiration not found");
  let media = await listMedia(inspirationId);
  if (insp.timeRange) media = media.filter((m) => m.timeSec == null || (m.timeSec >= insp.timeRange!.from && m.timeSec <= insp.timeRange!.to));
  media = media.slice(0, MAX_IMAGES_PER_REQUEST);
  const blobs = await fitImagesToBudget(
    media.map((m) => m.blob),
    MAX_REQUEST_BYTES - 200_000,
  );
  const images = await Promise.all(blobs.map(async (b, i) => ({ base64: await blobToBase64(b), label: media[i].timeSec != null ? `frame at ${Math.round(media[i].timeSec!)} s` : "screenshot" })));
  let cost = 0;
  const dna = await postStream<z.infer<typeof DesignDnaSchema> & { kelvin: number | null }>(
    "/api/ai/inspiration",
    { url: insp.url, title: insp.title, caption: insp.caption, note: insp.note, images },
    { signal: cb.signal, onProgress: (m) => cb.onProgress("inspiration", m), onCost: (e) => ((cost += e.usd), cb.onCost?.(e)) },
  );
  await saveInspiration({ ...insp, dna });
  return cost;
}

// ---------------------------------------------------------------------------
// B–F. Designs
// ---------------------------------------------------------------------------

export type DesignRunOptions =
  | { kind: "new"; count?: number }
  | { kind: "buildOn"; parentId: ID; feedback: string; count: number; lockedIds: ID[] };

async function saveCheckpoint(roomId: ID, cp: PipelineCheckpoint | undefined) {
  await updateRoom(roomId, { pipeline: cp });
}

function geometryWarnings(room: RoomModel, items: Design["items"]): DesignWarning[] {
  try {
    return checkDesign(room, items);
  } catch (e) {
    console.error("checkDesign failed", e);
    return [];
  }
}

async function styleContext(room: Room) {
  const s = room.styleSource;
  if (s.mode === "matchRoom") {
    const other = await getDesign(s.designId);
    return { mode: "matchRoom" as const, otherRoomDesign: other ? compactDesign(other) : undefined };
  }
  if (s.mode === "inspiration") {
    const insps = (await listInspirations(room.projectId)).filter((i) => s.inspirationIds.includes(i.id) && i.dna);
    return { mode: "inspiration" as const, dnas: insps.map((i) => ({ note: i.note, ...i.dna })), elements: s.elements };
  }
  return { mode: "independent" as const };
}

function inventoryForPrompt(inv: InventoryItem[], roomId: ID) {
  return inv
    .filter((i) => i.roomId === roomId || i.roomId === null)
    .map((i) => ({ id: i.id, name: i.name, category: i.category, w: i.w, d: i.d, h: i.h, flag: i.flag, roomId: i.roomId, color: i.color ?? "", material: i.material ?? "", shape: i.shapeHint ?? "", description: i.description ?? "" }));
}

/** Starts a new run (new designs or build-on variations). */
export async function runDesigns(roomId: ID, opts: DesignRunOptions, cb: RunCallbacks): Promise<ID[]> {
  const room = await getRoom(roomId);
  if (!room?.model) throw new Error("Please capture and confirm the room first.");
  const inventory = await listInventory(room.projectId);
  const parent = opts.kind === "buildOn" ? await getDesign(opts.parentId) : undefined;
  const request = {
    roomName: room.name,
    room: room.model,
    inventory: inventoryForPrompt(inventory, roomId),
    taste: room.taste,
    style: await styleContext(room),
    idea: room.idea,
    budget: room.budget,
    count: opts.kind === "buildOn" ? opts.count : (opts.count ?? 3),
    buildOn: parent && opts.kind === "buildOn" ? { design: compactDesign(parent), feedback: opts.feedback, lockedKeys: opts.lockedIds } : undefined,
  };
  const cp: PipelineCheckpoint = {
    runId: newId(),
    kind: opts.kind,
    step: "concepts",
    designIds: [],
    productsDone: [],
    startedAt: Date.now(),
    costUsd: 0,
    request,
    parentId: parent?.id,
    lockedIds: opts.kind === "buildOn" ? opts.lockedIds : [],
  };
  await saveCheckpoint(roomId, cp);
  await continueRun(roomId, cb, cp);
  return cp.designIds;
}

/** Resumes the room's current run from its checkpoint. */
export async function resumeRun(roomId: ID, cb: RunCallbacks) {
  const room = await getRoom(roomId);
  const cp = room?.pipeline;
  if (!cp || cp.step === "done") return;
  if (cp.step === "concepts" && !cp.request) throw new Error("The run stopped before designs were created — please start it again.");
  cp.error = undefined;
  await continueRun(roomId, cb, cp);
}

/** B: all designs of a run in ONE call — the room's constraints are reasoned about once (measured: 3 designs
 *  ≈ $0.19 / ~2 min, vs. ≈ $0.38 + briefs for three separate calls). */
async function runConcepts(roomId: ID, cb: RunCallbacks, cp: PipelineCheckpoint) {
  const room = (await getRoom(roomId))!;
  const inventory = await listInventory(room.projectId);
  const parent = cp.parentId ? await getDesign(cp.parentId) : undefined;
  const req = cp.request as { count: number } & Record<string, unknown>;
  cb.onProgress("concepts", req.count > 1 ? `Designing ${req.count} distinct options…` : "Designing the variation…");
  const costs: CostEntry[] = [];
  const out = await postStream<ConceptsOut>("/api/ai/concepts", req, {
    signal: cb.signal,
    onProgress: (m) => cb.onProgress("concepts", m),
    onCost: (e) => {
      costs.push(e);
      cp.costUsd += e.usd;
      cb.onCost?.(e);
    },
  });
  const designs = out.designs.slice(0, req.count);
  if (!designs.length) throw new Error("The AI returned no designs — please retry.");
  for (let i = 0; i < designs.length; i++) {
    const d = designFromOut(designs[i], {
      roomId,
      projectId: room.projectId,
      roomModelVersion: room.model!.version,
      runId: cp.runId,
      inventory,
      parent,
      lockedIds: cp.lockedIds ?? [],
    });
    // the shared call's cost is split evenly across the designs of this run
    d.costs = costs.map((c) => ({ ...c, usd: c.usd / designs.length, note: "shared design call (split)" }));
    d.createdAt = cp.startedAt + i;
    await saveDesign(d);
    cp.designIds = [...cp.designIds, d.id];
  }
  cp.step = "check";
  await saveCheckpoint(roomId, cp);
}

async function continueRun(roomId: ID, cb: RunCallbacks, cp: PipelineCheckpoint) {
  const room = (await getRoom(roomId))!;
  const model = room.model!;
  const track = (designId: ID) => (e: CostEntry) => {
    cp.costUsd += e.usd;
    cb.onCost?.(e);
    void updateDesign(designId, (d) => ({ costs: [...d.costs, e] }));
  };
  try {
    if (cp.step === "concepts") await runConcepts(roomId, cb, cp);
    // C. geometry check + one repair round
    if (cp.step === "check") {
      for (const id of cp.designIds) {
        const d = await getDesign(id);
        if (!d) continue;
        let warnings = geometryWarnings(model, d.items);
        const problems = warnings.filter((w) => w.severity !== "hint");
        if (problems.length) {
          cb.onProgress(id, `Fixing ${problems.length} layout issue(s)…`);
          try {
            const rep = await postStream<RepairOut>(
              "/api/ai/repair",
              {
                room: model,
                items: d.items.map((i) => ({ id: i.id, category: i.category, label: i.label, x: i.x, y: i.y, rotation: i.rotation, w: i.w, d: i.d, h: i.h, z: i.z ?? 0, mount: i.mount ?? "floor" })),
                violations: problems.map((p) => ({ code: p.code, message: p.message, itemIds: p.itemIds })),
              },
              { signal: cb.signal, onProgress: (m) => cb.onProgress(id, m), onCost: track(id) },
            );
            const items = d.items
              .filter((i) => !rep.removeItemIds.includes(i.id))
              .map((i) => {
                const mv = rep.moves.find((m) => m.itemId === i.id);
                return mv ? { ...i, x: Math.round(mv.x), y: Math.round(mv.y), rotation: ((Math.round(mv.rotation) % 360) + 360) % 360, w: mv.w > 0 ? Math.round(mv.w) : i.w, d: mv.d > 0 ? Math.round(mv.d) : i.d, h: mv.h > 0 ? Math.round(mv.h) : i.h } : i;
              });
            warnings = geometryWarnings(model, items);
            await updateDesign(id, { items, warnings, status: "searching" });
          } catch (e) {
            if (cb.signal?.aborted) throw e;
            await updateDesign(id, { warnings, status: "searching" });
          }
        } else {
          await updateDesign(id, { warnings, status: "searching" });
        }
      }
      cp.step = "products";
      await saveCheckpoint(roomId, cp);
    }

    // D/E. product search per design (concurrency 2), shared slot groups searched once
    if (cp.step === "products") {
      const designs = (await Promise.all(cp.designIds.map((id) => getDesign(id)))).filter(Boolean) as Design[];
      const groups = new Map<string, { slot: Slot; designIds: ID[] }>();
      // Identical slots (same category, size class, colour, style, look-alike) are searched only once.
      const shortKeys = new Map<string, string>();
      const groupKeyOf = (s: Slot) => {
        const sig = [s.category, Math.round(s.maxW / 20), Math.round(s.maxD / 20), Math.round(s.maxH / 20), s.color.toLowerCase(), [...s.styleTags].sort().join("|").toLowerCase(), s.lookAlike ?? ""].join("~");
        if (!shortKeys.has(sig)) shortKeys.set(sig, `g${shortKeys.size + 1}`);
        return shortKeys.get(sig)!;
      };
      const owner = new Map<ID, string[]>(); // design id -> group keys it is responsible for
      for (const d of designs) {
        if (cp.productsDone.includes(d.id)) continue;
        for (const s of d.slots) {
          if (d.products[s.id]?.budget.length) continue; // locked slots keep their products
          const k = groupKeyOf(s);
          if (!groups.has(k)) {
            groups.set(k, { slot: s, designIds: [d.id] });
            owner.set(d.id, [...(owner.get(d.id) ?? []), k]);
          } else groups.get(k)!.designIds.push(d.id);
        }
      }
      const pending = designs.filter((d) => !cp.productsDone.includes(d.id));
      // Fixed, fair share of the remaining run budget per design (no design is left without products).
      const share = Math.max(0, ROOM_RUN_LIMIT_USD - cp.costUsd) / Math.max(1, pending.filter((d) => (owner.get(d.id) ?? []).length).length);
      let idx = 0;
      // Saves results to EVERY design that has a slot in the returned groups — immediately, so a
      // resume never loses products that were already paid for.
      const persistResults = async (products: CheckedProduct[], foundOn: string) => {
        const byGroup = new Map<string, CheckedProduct[]>();
        for (const p of products) byGroup.set(p.slotKey, [...(byGroup.get(p.slotKey) ?? []), p]);
        for (const [key, g] of groups) {
          if (!byGroup.has(key)) continue;
          for (const did of g.designIds) {
            await updateDesign(did, (x) => {
              const next = { ...x.products };
              for (const s of x.slots) if (groupKeyOf(s) === key && !next[s.id]?.budget.length) next[s.id] = toSlotProducts(byGroup.get(key)!, foundOn);
              return { products: next };
            });
          }
        }
      };
      const worker = async () => {
        while (idx < pending.length) {
          const d = pending[idx++];
          const keys = owner.get(d.id) ?? [];
          const remaining = ROOM_RUN_LIMIT_USD - cp.costUsd;
          if (keys.length && (remaining <= 0.03 || share <= 0.03)) {
            cp.stoppedForBudget = true;
            cb.onProgress(d.id, "Skipped product search: the $1.00 limit for this run was reached.");
            continue;
          }
          if (keys.length) {
            cb.onProgress(d.id, `Finding products for ${keys.length} item(s)…`);
            try {
              const res = await postStream<{ products: CheckedProduct[]; notes: string[]; stoppedForBudget: boolean; foundOn: string }>(
                "/api/ai/products",
                {
                  designName: d.name,
                  style: d.style,
                  budgetEur: room.budget,
                  slots: keys.map((k) => {
                    const s = groups.get(k)!.slot;
                    return { key: k, category: s.category, label: s.label, maxW: s.maxW, maxD: s.maxD, maxH: s.maxH, color: s.color, material: s.material, styleTags: s.styleTags, targetBudget: s.targetPrice.budget, targetNicer: s.targetPrice.nicer, quantity: s.quantity, lookAlike: s.lookAlike ?? "", notes: s.notes ?? "" };
                  }),
                  mode: "tiers",
                  maxSearches: Math.min(12, Math.max(3, keys.length + 1)),
                  stopAtUsd: Math.max(0.02, Math.min(0.35, share * 0.9, remaining)),
                },
                { signal: cb.signal, onProgress: (m) => cb.onProgress(d.id, m), onCost: track(d.id) },
              );
              if (res.stoppedForBudget) cp.stoppedForBudget = true;
              await persistResults(res.products, res.foundOn);
              await updateDesign(d.id, { status: "searching", errorMessage: undefined });
            } catch (e) {
              if (cb.signal?.aborted) throw e;
              await updateDesign(d.id, { status: "error", errorMessage: (e as Error).message });
              cb.onProgress(d.id, `Product search failed: ${(e as Error).message}`);
              continue;
            }
          }
          cp.productsDone.push(d.id);
          await saveCheckpoint(roomId, cp);
        }
      };
      await Promise.all([worker(), worker()]);

      if (cp.designIds.every((id) => cp.productsDone.includes(id)) || cp.stoppedForBudget) {
        cp.step = "final";
        await saveCheckpoint(roomId, cp);
      } else {
        throw new Error("Some designs could not get products — use Resume to retry them.");
      }
    }

    // F. final fit check with real product dimensions + paint quantities
    if (cp.step === "final") {
      for (const id of cp.designIds) {
        const d = await getDesign(id);
        if (!d) continue;
        cb.onProgress(id, "Checking that products fit…");
        const { design, extra } = finalizeDesign(model, d, room.budget);
        await saveDesign({ ...design, warnings: [...geometryWarnings(model, design.items), ...extra], status: d.status === "error" ? "error" : "ready" }, false);
      }
      cp.step = "done";
      await saveCheckpoint(roomId, cp);
      cb.onProgress("done", cp.stoppedForBudget ? "Done — product search stopped early to stay within $1.00." : "Done.");
    }
  } catch (e) {
    cp.error = (e as Error).message;
    await saveCheckpoint(roomId, cp);
    throw e;
  }
}

function toCandidate(p: CheckedProduct, foundOn: string): ProductCandidate {
  return {
    id: newId(),
    name: p.name,
    shop: p.shop,
    priceEur: Math.round(p.priceEur * 100) / 100,
    url: p.url,
    linkStatus: p.linkStatus === "dead" ? "dead → replaced" : p.linkStatus,
    thumbnailUrl: p.thumbnailUrl,
    w: p.w > 0 ? Math.round(p.w) : undefined,
    d: p.d > 0 ? Math.round(p.d) : undefined,
    h: p.h > 0 ? Math.round(p.h) : undefined,
    dimsVerified: p.dimsVerified && p.w > 0,
    why: p.why,
    assembly: p.assembly,
    bulky: p.bulky,
    pickup: p.pickup,
    foundOn,
    similarity: p.similarity || undefined,
  };
}

function toSlotProducts(found: CheckedProduct[], foundOn: string): SlotProducts {
  const by = (tier: "budget" | "nicer") =>
    found
      .filter((p) => p.tier === tier)
      .sort((a, b) => a.rank - b.rank)
      .map((p) => toCandidate(p, foundOn))
      // dead links go to the end (shown as "dead → replaced", never selected)
      .sort((a, b) => Number(a.linkStatus === "dead → replaced") - Number(b.linkStatus === "dead → replaced"));
  return { budget: by("budget"), nicer: by("nicer"), selected: { budget: 0, nicer: 0 } };
}

/** F: label every candidate with fit, select the first good one per tier, compute paint. */
export function finalizeDesign(model: RoomModel, d: Design, budget: number | null): { design: Design; extra: DesignWarning[] } {
  const design: Design = structuredClone(d);
  const extra: DesignWarning[] = [];
  for (const s of design.slots) {
    const sp = design.products[s.id];
    if (!sp) continue;
    for (const tier of ["budget", "nicer"] as const) {
      const list = sp[tier];
      let chosen = -1;
      let movedTo: { x: number; y: number } | null = null;
      list.forEach((c, i) => {
        if (c.linkStatus === "dead → replaced") return;
        if (s.placedItemId && c.dimsVerified) {
          try {
            const f = fitProduct(model, design.items, s.placedItemId, { w: c.w, d: c.d, h: c.h });
            c.fit = f.label;
            c.fitReason = f.reason;
            if (chosen < 0 && f.label === "fits") chosen = i;
            if (chosen < 0 && f.label === "fits if moved" && !movedTo && f.moved) movedTo = { x: f.moved.x, y: f.moved.y };
          } catch {
            /* geometry failure: leave unlabeled */
          }
        } else if (chosen < 0 && (!s.placedItemId || !c.dimsVerified)) {
          chosen = i;
        }
      });
      if (chosen < 0) {
        const firstMovable = list.findIndex((c) => c.linkStatus !== "dead → replaced" && c.fit === "fits if moved");
        if (firstMovable >= 0) {
          chosen = firstMovable;
          if (tier === "budget" && movedTo && s.placedItemId) {
            const pos = movedTo as { x: number; y: number };
            design.items = design.items.map((it) => (it.id === s.placedItemId ? { ...it, x: pos.x, y: pos.y } : it));
          }
        } else {
          chosen = list.findIndex((c) => c.linkStatus !== "dead → replaced");
          if (chosen >= 0 && list[chosen].fit === "doesn't fit") {
            extra.push({ code: "productFit", severity: "warning", itemIds: s.placedItemId ? [s.placedItemId] : [], message: `${s.label}: none of the found ${tier === "budget" ? "Budget" : "Nicer"} products fits exactly (${list[chosen].fitReason ?? "size"}). Check the dimensions or find alternatives.` });
          }
        }
      }
      sp.selected[tier] = Math.max(0, chosen);
    }
    if (!sp.budget.length && !sp.nicer.length) {
      extra.push({ code: "noProducts", severity: "hint", itemIds: s.placedItemId ? [s.placedItemId] : [], message: `${s.label}: no verified product found — use "Find alternatives" to search again.` });
    }
  }
  if (design.colors.paint) {
    try {
      design.paintCalc = paintCalc(model, design.colors.paint.surfaces);
    } catch {
      design.paintCalc = null;
    }
  }
  if (budget != null) {
    const total = tierTotal(design, "budget");
    if (total > budget) extra.push({ code: "budget", severity: "warning", itemIds: [], message: `The Budget tier totals €${total.toFixed(2)}, above your €${budget} budget. Find cheaper alternatives for the biggest items.` });
  }
  return { design, extra };
}

// ---------------------------------------------------------------------------
// G. Alternatives for one item
// ---------------------------------------------------------------------------
export async function findAlternatives(designId: ID, slotId: ID, wish: string, cb: RunCallbacks): Promise<ProductCandidate[]> {
  const d = await getDesign(designId);
  if (!d) throw new Error("Design not found");
  const room = await getRoom(d.roomId);
  const s = d.slots.find((x) => x.id === slotId);
  if (!s || !room?.model) throw new Error("Item not found");
  const res = await postStream<{ products: CheckedProduct[]; foundOn: string }>(
    "/api/ai/products",
    {
      designName: d.name,
      style: d.style,
      budgetEur: room.budget,
      slots: [{ key: s.id, category: s.category, label: s.label, maxW: s.maxW, maxD: s.maxD, maxH: s.maxH, color: s.color, material: s.material, styleTags: s.styleTags, targetBudget: s.targetPrice.budget, targetNicer: s.targetPrice.nicer, quantity: s.quantity, lookAlike: s.lookAlike ?? "", notes: s.notes ?? "" }],
      mode: "alternatives",
      wish,
      maxSearches: 4,
      stopAtUsd: 0.09,
    },
    {
      signal: cb.signal,
      onProgress: (m) => cb.onProgress("alternatives", m),
      onCost: (e) => {
        cb.onCost?.(e);
        void updateDesign(designId, (x) => ({ costs: [...x.costs, e] }));
      },
    },
  );
  const cands = res.products
    .filter((p) => p.linkStatus !== "dead")
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 5)
    .map((p) => toCandidate(p, res.foundOn));
  if (s.placedItemId) {
    for (const c of cands) {
      try {
        const f = fitProduct(room.model, d.items, s.placedItemId, { w: c.w, d: c.d, h: c.h });
        c.fit = f.label;
        c.fitReason = f.reason;
      } catch {
        /* leave unlabeled */
      }
    }
  }
  return cands;
}

/** Puts an alternative into the design for the given tier; optionally applies a moved position. */
export async function swapProduct(designId: ID, slotId: ID, tier: "budget" | "nicer", cand: ProductCandidate, mode: "auto-adjust" | "keep anyway") {
  const d = await getDesign(designId);
  const room = d ? await getRoom(d.roomId) : null;
  if (!d || !room?.model) return;
  const products = structuredClone(d.products);
  const sp = products[slotId] ?? { budget: [], nicer: [], selected: { budget: 0, nicer: 0 } };
  sp[tier] = [cand, ...sp[tier].filter((c) => c.id !== cand.id)];
  sp.selected[tier] = 0;
  products[slotId] = sp;
  let items = d.items;
  const slot = d.slots.find((s) => s.id === slotId);
  if (slot?.placedItemId && cand.dimsVerified) {
    items = items.map((it) => (it.id === slot.placedItemId ? { ...it, w: cand.w ?? it.w, d: cand.d ?? it.d, h: cand.h ?? it.h } : it));
    if (mode === "auto-adjust") {
      try {
        const f = fitProduct(room.model, d.items, slot.placedItemId, { w: cand.w, d: cand.d, h: cand.h });
        if (f.moved) items = items.map((it) => (it.id === slot.placedItemId ? { ...it, x: f.moved!.x, y: f.moved!.y } : it));
      } catch {
        /* keep position */
      }
    }
  }
  const updated: Design = { ...d, products, items };
  const { design, extra } = finalizeDesign(room.model, { ...updated }, room.budget);
  // keep the user's explicit choice selected
  design.products[slotId].selected[tier] = 0;
  await saveDesign({ ...design, warnings: [...geometryWarnings(room.model, design.items), ...extra] });
}

/** Creates a purchase slot for an existing "replaceable" inventory item so a replacement can be searched. */
export async function ensureSlotForItem(designId: ID, itemId: ID): Promise<ID | null> {
  const d = await getDesign(designId);
  if (!d) return null;
  const it = d.items.find((i) => i.id === itemId);
  if (!it) return null;
  if (it.ref.type === "slot") return it.ref.slotId;
  const slot: Slot = {
    id: newId(),
    placedItemId: it.id,
    category: it.category,
    label: `Replacement for ${it.label}`,
    maxW: Math.round(it.w * 1.1),
    maxD: Math.round(it.d * 1.1),
    maxH: Math.round(it.h * 1.05),
    color: it.colorHex ?? "",
    material: it.material ?? "",
    styleTags: d.style.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 3),
    targetPrice: { budget: 0, nicer: 0 },
    quantity: 1,
  };
  await saveDesign({ ...d, slots: [...d.slots, slot] });
  return slot.id;
}

/** After a swap that replaced an existing item: point the item at the new slot and list the old one as removed. */
export async function replaceInventoryItem(designId: ID, itemId: ID, slotId: ID) {
  await updateDesign(designId, (d) => {
    const it = d.items.find((i) => i.id === itemId);
    if (!it || it.ref.type !== "inventory") return {};
    const invId = it.ref.inventoryId;
    return {
      items: d.items.map((i) => (i.id === itemId ? { ...i, ref: { type: "slot" as const, slotId } } : i)),
      removed: [...d.removed.filter((r) => r.inventoryId !== invId), { inventoryId: invId, reason: "Replaced by a new product in this design." }],
    };
  });
}

/** Marks a design as chosen: removed inventory items become spare for other rooms. */
export async function chooseDesign(roomId: ID, designId: ID | null) {
  const { saveInventory } = await import("./db");
  const room = await getRoom(roomId);
  if (!room) return;
  const inv = await listInventory(room.projectId);
  // undo spare marks from the previously chosen design
  for (const i of inv.filter((x) => x.removedFrom?.roomId === roomId)) await saveInventory({ ...i, roomId, removedFrom: undefined });
  if (designId) {
    const d = await getDesign(designId);
    for (const r of d?.removed ?? []) {
      const item = inv.find((x) => x.id === r.inventoryId);
      if (item && item.roomId === roomId) await saveInventory({ ...item, roomId: null, removedFrom: { roomId, designId } });
    }
  }
  await updateRoom(roomId, { chosenDesignId: designId });
}

export async function recheckDesign(designId: ID) {
  const d = await getDesign(designId);
  const room = d ? await getRoom(d.roomId) : null;
  if (!d || !room?.model) return;
  const { design, extra } = finalizeDesign(room.model, d, room.budget);
  await saveDesign({ ...design, roomModelVersion: room.model.version, warnings: [...geometryWarnings(room.model, design.items), ...extra] });
}

export async function roomRunsCost(roomId: ID): Promise<number> {
  return (await listDesigns(roomId)).reduce((s, d) => s + d.costs.reduce((a, c) => a + c.usd, 0), 0);
}
