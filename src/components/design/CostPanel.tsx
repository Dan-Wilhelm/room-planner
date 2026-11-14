"use client";

import { EUR_PER_USD, formatUsd, PRICES_AS_OF } from "@/lib/pricing";
import type { CostEntry } from "@/lib/types";

export function CostPanel({ costs, title = "Costs" }: { costs: CostEntry[]; title?: string }) {
  if (!costs.length) return <p className="text-xs text-stone-500">No costs recorded.</p>;
  const by = new Map<string, CostEntry[]>();
  for (const c of costs) by.set(c.step, [...(by.get(c.step) ?? []), c]);
  const total = costs.reduce((s, c) => s + c.usd, 0);
  return (
    <details className="text-sm">
      <summary className="cursor-pointer font-medium text-stone-700">
        {title}: {formatUsd(total)} (≈ €{(total * EUR_PER_USD).toFixed(total < 0.1 ? 3 : 2)})
      </summary>
      <table className="mt-2 w-full text-xs">
        <thead>
          <tr className="text-left text-stone-500">
            <th className="pr-2">Step</th>
            <th className="pr-2">Calls</th>
            <th className="pr-2">Input tok.</th>
            <th className="pr-2">Output tok.</th>
            <th className="pr-2">Cache read</th>
            <th className="pr-2">Searches</th>
            <th className="pr-2">Images</th>
            <th className="pr-2">USD</th>
          </tr>
        </thead>
        <tbody>
          {[...by.entries()].map(([step, list]) => (
            <tr key={step} className="border-t border-stone-100">
              <td className="pr-2">
                {step}
                {list.some((c) => c.failed) && " (incl. failed)"}
              </td>
              <td className="pr-2 tabular-nums">{list.length}</td>
              <td className="pr-2 tabular-nums">{list.reduce((s, c) => s + c.inputTokens, 0).toLocaleString("en")}</td>
              <td className="pr-2 tabular-nums">{list.reduce((s, c) => s + c.outputTokens, 0).toLocaleString("en")}</td>
              <td className="pr-2 tabular-nums">{list.reduce((s, c) => s + c.cacheReadTokens, 0).toLocaleString("en")}</td>
              <td className="pr-2 tabular-nums">{list.reduce((s, c) => s + c.searches, 0)}</td>
              <td className="pr-2 tabular-nums">{list.reduce((s, c) => s + c.images, 0)}</td>
              <td className="pr-2 tabular-nums">{formatUsd(list.reduce((s, c) => s + c.usd, 0))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[11px] text-stone-400">Prices as of {PRICES_AS_OF}; EUR is approximate. Shared concept calls are split evenly across the designs of a run.</p>
    </details>
  );
}
