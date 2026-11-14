"use client";

import { useState } from "react";
import type { ProductCandidate } from "@/lib/types";
import { Badge, ExternalLink } from "../ui";

export function ProductCard({ p, compact }: { p: ProductCandidate; compact?: boolean }) {
  const [imgOk, setImgOk] = useState(true);
  const linkTone = p.linkStatus === "verified" ? "green" : p.linkStatus === "dead → replaced" ? "red" : p.linkStatus === "unchecked" ? "stone" : "amber";
  return (
    <div className="flex gap-3">
      {p.thumbnailUrl && imgOk && /^https?:\/\//.test(p.thumbnailUrl) ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.thumbnailUrl} alt="" referrerPolicy="no-referrer" onError={() => setImgOk(false)} className={`${compact ? "h-14 w-14" : "h-20 w-20"} shrink-0 rounded bg-stone-100 object-contain ring-1 ring-stone-200`} />
      ) : (
        <div className={`${compact ? "h-14 w-14" : "h-20 w-20"} flex shrink-0 items-center justify-center rounded bg-stone-100 text-[10px] text-stone-400`}>no image</div>
      )}
      <div className="min-w-0 flex-1 text-sm">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium text-stone-900">{p.name}</span>
          <span className="font-semibold tabular-nums">€{p.priceEur.toFixed(2)}</span>
        </div>
        <div className="text-xs text-stone-600">
          {p.shop} · <ExternalLink href={p.url}>shop page</ExternalLink>
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          <Badge tone={linkTone} title="Link check by our server">
            {p.linkStatus}
          </Badge>
          {p.dimsVerified && p.w ? (
            <Badge>
              {p.w}×{p.d ?? "?"}×{p.h ?? "?"} cm
            </Badge>
          ) : (
            <Badge tone="amber">dimensions not verified</Badge>
          )}
          {p.assembly && <Badge>assembly</Badge>}
          {p.bulky && <Badge>bulky — car needed</Badge>}
          {p.pickup && <Badge tone="blue">pickup possible</Badge>}
          {p.fit && <Badge tone={p.fit === "fits" ? "green" : p.fit === "fits if moved" ? "amber" : "red"}>{p.fit}</Badge>}
        </div>
        {!compact && <p className="mt-1 text-xs text-stone-600">{p.why}</p>}
        {p.similarity && <p className="mt-1 text-xs text-violet-700">Look-alike: {p.similarity}</p>}
        <p className="text-[11px] text-stone-400">price found on {p.foundOn}</p>
      </div>
    </div>
  );
}
