import { z } from "zod";
import { isMock } from "@/lib/server/ai/client";
import { mockProducts } from "@/lib/server/ai/mock";
import { ndjsonResponse } from "@/lib/server/ai/ndjson";
import { searchProducts } from "@/lib/server/ai/products";
import { readJson } from "@/lib/server/ai/request";
import { checkProductLink } from "@/lib/server/fetch";

export const maxDuration = 800;

const SlotReq = z.object({
  key: z.string().max(80),
  category: z.string().max(40),
  label: z.string().max(200),
  maxW: z.number(),
  maxD: z.number(),
  maxH: z.number(),
  color: z.string().max(100),
  material: z.string().max(100),
  styleTags: z.array(z.string().max(60)).max(10),
  targetBudget: z.number(),
  targetNicer: z.number(),
  quantity: z.number(),
  lookAlike: z.string().max(400),
  notes: z.string().max(400),
});

const Body = z.object({
  designName: z.string().max(200),
  style: z.string().max(400),
  budgetEur: z.number().nullable(),
  slots: z.array(SlotReq).min(1).max(25),
  mode: z.enum(["tiers", "alternatives"]),
  wish: z.string().max(500).optional(),
  maxSearches: z.number().int().min(1).max(20),
  stopAtUsd: z.number().min(0).max(1),
});

export interface CheckedProduct {
  slotKey: string;
  tier: "budget" | "nicer" | "alternative";
  rank: number;
  name: string;
  shop: string;
  priceEur: number;
  url: string;
  w: number;
  d: number;
  h: number;
  dimsVerified: boolean;
  why: string;
  assembly: boolean;
  bulky: boolean;
  pickup: boolean;
  similarity: string;
  linkStatus: "verified" | "could not verify" | "dead" | "unchecked";
  thumbnailUrl?: string;
  finalUrl?: string;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function POST(req: Request) {
  const parsed = await readJson(req, Body);
  if ("error" in parsed) return parsed.error;
  const b = parsed.body;
  return ndjsonResponse(req, async (emit) => {
    if (isMock()) {
      const r = await mockProducts(emit, b.slots, b.mode);
      const products: CheckedProduct[] = r.products.map((p) => ({ ...p, linkStatus: "unchecked" }));
      return { products, notes: [r.notes], droppedUnknownUrls: 0, stoppedForBudget: false, foundOn: new Date().toISOString().slice(0, 10) };
    }
    const res = await searchProducts(
      {
        designName: b.designName,
        style: b.style,
        budgetEur: b.budgetEur,
        slots: b.slots,
        mode: b.mode,
        wish: b.wish,
        maxSearches: b.maxSearches,
        stopAtUsd: b.stopAtUsd,
      },
      emit,
      b.mode === "alternatives" ? "alternatives" : "products",
    );
    emit.progress(`Checking ${res.products.length} product links…`);
    let checked = 0;
    const products = await mapLimit(res.products, 6, async (p): Promise<CheckedProduct> => {
      try {
        const c = await checkProductLink(p.url);
        checked++;
        if (checked % 5 === 0) emit.progress(`Checking product links ${checked}/${res.products.length}…`, checked, res.products.length);
        return { ...p, linkStatus: c.status, thumbnailUrl: c.ogImage, finalUrl: c.finalUrl };
      } catch {
        return { ...p, linkStatus: "could not verify" };
      }
    });
    return {
      products,
      notes: res.notes,
      droppedUnknownUrls: res.droppedUnknownUrls,
      stoppedForBudget: res.stoppedForBudget,
      diagnostics: res.diagnostics,
      foundOn: new Date().toISOString().slice(0, 10),
    };
  });
}
