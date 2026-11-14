"use client";

/**
 * 2D top view of a room (SVG). Plan coordinates are cm with y pointing north (up), so every
 * point is drawn at (x, −y). Items can be selected and — if listed in `movableIds` — dragged
 * (5 cm snap, `onMoveItem` is called on pointer up) or moved with the arrow keys.
 */
import { useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { CeilingFeature, DesignWarning, ItemCategory, PlacedItem, Point, RoomModel, Slope, WallFeature } from "@/lib/types";
import {
  featureSegment,
  itemFootprint,
  itemSide,
  polygonAreaM2,
  polygonBounds,
  snapToGrid,
  wallSegment,
} from "@/lib/geometry";

export interface TopView2DProps {
  room: RoomModel;
  items?: PlacedItem[];
  warnings?: DesignWarning[];
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  onMoveItem?: (id: string, x: number, y: number) => void;
  movableIds?: string[];
  /** Estimate paths (e.g. "corners.2.x", "wallFeatures.<id>.width") drawn amber/dashed. */
  highlightPaths?: string[];
  className?: string;
}

// ---------------------------------------------------------------------------
// Styling
// ---------------------------------------------------------------------------

const C = {
  floor: "#f8f7f4",
  wall: "#1f2937",
  dim: "#475569",
  faint: "#94a3b8",
  door: "#0f766e",
  window: "#0284c7",
  radiator: "#ea580c",
  electric: "#7c3aed",
  slope: "#64748b",
  roofWindow: "#0ea5e9",
  light: "#ca8a04",
  selected: "#2563eb",
  error: "#dc2626",
  warning: "#d97706",
  estimate: "#d97706",
};

const CATEGORY_COLOR: Partial<Record<ItemCategory, string>> = {
  bed: "#bfdbfe",
  sofa: "#c7d2fe",
  armchair: "#c7d2fe",
  chair: "#e9d5ff",
  deskChair: "#e9d5ff",
  desk: "#fde68a",
  table: "#fde68a",
  sideTable: "#fef3c7",
  nightstand: "#fef3c7",
  wardrobe: "#d6d3d1",
  dresser: "#e7e5e4",
  shelf: "#e7e5e4",
  tvUnit: "#e7e5e4",
  floorLamp: "#fef08a",
  tableLamp: "#fef08a",
  pendantLamp: "#fef08a",
  wallLight: "#fef08a",
  ledStrip: "#fef08a",
  rug: "#fce7f3",
  curtain: "#ccfbf1",
  blind: "#ccfbf1",
  plant: "#bbf7d0",
  decor: "#f5f5f4",
  mirror: "#e0f2fe",
  art: "#fae8ff",
};

const NON_SPATIAL = new Set<ItemCategory>(["paint", "material", "cushion", "throw"]);

// ---------------------------------------------------------------------------
// Geometry helpers (drawing only)
// ---------------------------------------------------------------------------

const S = (p: Point) => ({ x: p.x, y: -p.y });
const pts = (poly: Point[]) => poly.map((p) => `${r1(p.x)},${r1(-p.y)}`).join(" ");
const r1 = (v: number) => Math.round(v * 10) / 10;
const addP = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Point, s: number): Point => ({ x: a.x * s, y: a.y * s });

/** Sutherland–Hodgman clip of a polygon against the half-plane dot(p − o, n) ≤ k. */
function clipHalfPlane(poly: Point[], o: Point, n: Point, k: number): Point[] {
  const f = (p: Point) => (p.x - o.x) * n.x + (p.y - o.y) * n.y - k;
  const out: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const fa = f(a);
    const fb = f(b);
    if (fa <= 0) out.push(a);
    if ((fa < 0 && fb > 0) || (fa > 0 && fb < 0)) {
      const t = fa / (fa - fb);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

function slopeBand(room: RoomModel, s: Slope): Point[] {
  const w = wallSegment(room, s.wallIndex);
  const n = w.inwardNormal;
  let poly = clipHalfPlane(room.corners, w.a, n, s.fullHeightDistance);
  poly = clipHalfPlane(poly, w.a, mul(n, -1), 0);
  return poly;
}

function shortLabel(item: PlacedItem): string {
  const l = (item.label || item.category).trim();
  return l.length > 14 ? `${l.slice(0, 13)}…` : l;
}

function hasPrefix(paths: Set<string>, prefix: string): boolean {
  for (const p of paths) if (p === prefix || p.startsWith(`${prefix}.`)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TopView2D({
  room,
  items = [],
  warnings = [],
  selectedId = null,
  onSelect,
  onMoveItem,
  movableIds = [],
  highlightPaths = [],
  className,
}: TopView2DProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ id: string; start: Point; item: Point; pointerId: number; last: Point } | null>(null);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);

  const hl = useMemo(() => new Set(highlightPaths), [highlightPaths]);
  const movable = useMemo(() => new Set(movableIds), [movableIds]);
  const n = room.corners.length;
  const valid = n >= 3;

  const view = useMemo(() => {
    const bb = valid ? polygonBounds(room.corners) : { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    const size = Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY, 100);
    const pad = Math.max(60, size * 0.16);
    const fs = Math.min(40, Math.max(9, size * 0.03));
    return { bb, size, pad, fs, vb: `${r1(bb.minX - pad)} ${r1(-bb.maxY - pad)} ${r1(bb.maxX - bb.minX + 2 * pad)} ${r1(bb.maxY - bb.minY + 2 * pad)}` };
  }, [room.corners, valid]);
  const { fs, bb, pad } = view;

  const severityById = useMemo(() => {
    const m = new Map<string, "error" | "warning">();
    for (const w of warnings) {
      if (w.severity === "hint") continue;
      for (const id of w.itemIds) {
        if (w.severity === "error" || !m.has(id)) m.set(id, w.severity);
      }
    }
    return m;
  }, [warnings]);

  const messagesById = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const w of warnings) for (const id of w.itemIds) m.set(id, [...(m.get(id) ?? []), w.message]);
    return m;
  }, [warnings]);

  if (!valid) {
    return (
      <div className={`flex items-center justify-center rounded-lg border border-dashed border-slate-300 p-6 text-sm text-slate-500 ${className ?? ""}`}>
        No room outline yet.
      </div>
    );
  }

  const toPlan = (clientX: number, clientY: number): Point | null => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: -p.y };
  };

  const onItemPointerDown = (e: PointerEvent<SVGGElement>, it: PlacedItem) => {
    e.stopPropagation();
    onSelect?.(it.id);
    if (!movable.has(it.id) || !onMoveItem) return;
    const p = toPlan(e.clientX, e.clientY);
    if (!p) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { id: it.id, start: p, item: { x: it.x, y: it.y }, pointerId: e.pointerId, last: { x: it.x, y: it.y } };
  };

  const onItemPointerMove = (e: PointerEvent<SVGGElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const p = toPlan(e.clientX, e.clientY);
    if (!p) return;
    const x = snapToGrid(d.item.x + p.x - d.start.x);
    const y = snapToGrid(d.item.y + p.y - d.start.y);
    if (x === d.last.x && y === d.last.y) return;
    d.last = { x, y };
    setDrag({ id: d.id, x, y });
  };

  const onItemPointerUp = (e: PointerEvent<SVGGElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (d.last.x !== d.item.x || d.last.y !== d.item.y) onMoveItem?.(d.id, d.last.x, d.last.y);
    setDrag(null);
  };

  const onItemKey = (e: KeyboardEvent<SVGGElement>, it: PlacedItem) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect?.(it.id);
      return;
    }
    if (!movable.has(it.id) || !onMoveItem) return;
    const step = e.shiftKey ? 25 : 5;
    const delta: Record<string, Point> = { ArrowUp: { x: 0, y: step }, ArrowDown: { x: 0, y: -step }, ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 } };
    const dlt = delta[e.key];
    if (!dlt) return;
    e.preventDefault();
    onMoveItem(it.id, snapToGrid(it.x + dlt.x), snapToGrid(it.y + dlt.y));
  };

  const walls = room.corners.map((_, i) => wallSegment(room, i + 1));
  const area = polygonAreaM2(room.corners);
  const cornerHl = (i: number) => hasPrefix(hl, `corners.${i}`);
  const wallHl = (wi: number) => cornerHl(wi - 1) || cornerHl(wi % n);

  const visibleItems = items
    .filter((it) => !NON_SPATIAL.has(it.category) && it.w > 0 && it.d > 0)
    .map((it) => (drag && drag.id === it.id ? { ...it, x: drag.x, y: drag.y } : it));
  const layer = (it: PlacedItem) => (it.category === "rug" ? 0 : it.mount === "ceiling" ? 3 : it.mount === "wall" || (it.z ?? 0) > 0 ? 2 : it.stackedOn || it.mount === "onTop" ? 2 : 1);
  visibleItems.sort((a, b) => layer(a) - layer(b));

  const north = -(room.northAngle || 0);
  const compass = { x: bb.maxX + pad * 0.55, y: bb.maxY + pad * 0.35 };

  return (
    <div className={`relative w-full select-none ${className ?? ""}`}>
      <svg
        ref={svgRef}
        viewBox={view.vb}
        className="h-auto w-full touch-none"
        role="img"
        aria-label={`Room plan, ${area.toFixed(2)} square metres, ${n} walls`}
        onPointerDown={() => onSelect?.(null)}
        style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}
      >
        <defs>
          <pattern id={`hatch-${uid}`} patternUnits="userSpaceOnUse" width={fs * 0.9} height={fs * 0.9} patternTransform="rotate(45)">
            <line x1={0} y1={0} x2={0} y2={fs * 0.9} stroke={C.slope} strokeWidth={fs * 0.12} strokeOpacity={0.45} />
          </pattern>
          <clipPath id={`room-${uid}`}>
            <polygon points={pts(room.corners)} />
          </clipPath>
        </defs>

        {/* floor */}
        <polygon points={pts(room.corners)} fill={C.floor} stroke="none" />

        {/* slopes */}
        {room.slopes.map((s) => {
          if (s.wallIndex < 1 || s.wallIndex > n) return null;
          const band = slopeBand(room, s);
          const w = wallSegment(room, s.wallIndex);
          const amber = hasPrefix(hl, `slopes.${s.id}`);
          const mid = addP(addP(w.a, mul(w.dir, w.length / 2)), mul(w.inwardNormal, Math.min(s.fullHeightDistance / 2, fs * 1.4)));
          const fullA = addP(w.a, mul(w.inwardNormal, s.fullHeightDistance));
          const fullB = addP(w.b, mul(w.inwardNormal, s.fullHeightDistance));
          return (
            <g key={s.id}>
              {band.length >= 3 && <polygon points={pts(band)} fill={`url(#hatch-${uid})`} stroke="none" />}
              <line x1={fullA.x} y1={-fullA.y} x2={fullB.x} y2={-fullB.y} stroke={amber ? C.estimate : C.slope} strokeWidth={fs * 0.1} strokeDasharray={`${fs * 0.5} ${fs * 0.35}`} />
              <title>{`Sloped ceiling from W${s.wallIndex}: ${Math.round(s.kneeWallHeight)} cm at the wall, full height (${Math.round(room.ceilingHeight)} cm) after ${Math.round(s.fullHeightDistance)} cm`}</title>
              <text x={mid.x} y={-mid.y} fontSize={fs * 0.7} textAnchor="middle" dominantBaseline="middle" fill={amber ? C.estimate : C.slope} fontWeight={600} paintOrder="stroke" stroke={C.floor} strokeWidth={fs * 0.25}>
                {`slope · knee wall ${Math.round(s.kneeWallHeight)} cm`}
              </text>
            </g>
          );
        })}

        {/* items */}
        {visibleItems.map((it) => {
          const fp = itemFootprint(it);
          const front = itemSide(it, "front");
          const sev = severityById.get(it.id);
          const selected = selectedId === it.id;
          const canMove = movable.has(it.id) && !!onMoveItem;
          const elevated = it.mount === "wall" || it.mount === "ceiling" || (it.z ?? 0) > 0;
          const fill = it.colorHex && /^#[0-9a-f]{6}$/i.test(it.colorHex) ? it.colorHex : (CATEGORY_COLOR[it.category] ?? "#e5e7eb");
          const stroke = sev === "error" ? C.error : sev === "warning" ? C.warning : selected ? C.selected : "#334155";
          const minSide = Math.min(it.w, it.d);
          const lfs = Math.min(fs * 0.8, Math.max(fs * 0.45, minSide / 4));
          const tip = [it.label || it.category, `${it.w} × ${it.d} × ${it.h} cm`, ...(messagesById.get(it.id) ?? [])].join("\n");
          return (
            <g
              key={it.id}
              role="button"
              tabIndex={0}
              aria-label={`${it.label || it.category}${selected ? ", selected" : ""}${sev ? `, has ${sev}` : ""}`}
              aria-pressed={selected}
              className={canMove ? "cursor-move outline-none" : "cursor-pointer outline-none"}
              onPointerDown={(e) => onItemPointerDown(e, it)}
              onPointerMove={onItemPointerMove}
              onPointerUp={onItemPointerUp}
              onPointerCancel={onItemPointerUp}
              onKeyDown={(e) => onItemKey(e, it)}
            >
              <title>{tip}</title>
              {selected && <polygon points={pts(fp)} fill="none" stroke={C.selected} strokeOpacity={0.25} strokeWidth={fs * 0.7} strokeLinejoin="round" />}
              <polygon
                points={pts(fp)}
                fill={fill}
                fillOpacity={it.category === "rug" ? 0.55 : elevated ? 0.5 : 0.9}
                stroke={stroke}
                strokeWidth={sev ? fs * 0.22 : selected ? fs * 0.18 : fs * 0.08}
                strokeDasharray={elevated && !sev ? `${fs * 0.3} ${fs * 0.2}` : undefined}
                strokeLinejoin="round"
              />
              {it.category !== "rug" && (
                <line x1={front.a.x} y1={-front.a.y} x2={front.b.x} y2={-front.b.y} stroke={stroke} strokeWidth={fs * 0.22} strokeLinecap="round" opacity={0.75} />
              )}
              <text x={it.x} y={-it.y} fontSize={lfs} textAnchor="middle" dominantBaseline="middle" fill="#0f172a" pointerEvents="none">
                {shortLabel(it)}
              </text>
            </g>
          );
        })}

        {/* walls */}
        <polygon points={pts(room.corners)} fill="none" stroke={C.wall} strokeWidth={Math.max(3, fs * 0.35)} strokeLinejoin="miter" pointerEvents="none" />

        {/* wall features */}
        {room.wallFeatures.map((f) => (f.wallIndex >= 1 && f.wallIndex <= n ? <WallFeatureShape key={f.id} room={room} f={f} fs={fs} amber={hasPrefix(hl, `wallFeatures.${f.id}`)} /> : null))}

        {/* ceiling features (clipped to the room) */}
        <g clipPath={`url(#room-${uid})`}>
          {room.ceilingFeatures.map((c) => (
            <CeilingFeatureShape key={c.id} room={room} c={c} fs={fs} amber={hasPrefix(hl, `ceilingFeatures.${c.id}`)} />
          ))}
        </g>

        {/* wall labels + dimensions */}
        {walls.map((w) => {
          const mid = addP(w.a, mul(w.dir, w.length / 2));
          const out = mul(w.inwardNormal, -1);
          const vertical = Math.abs(w.dir.y) > Math.abs(w.dir.x);
          const dimP = addP(mid, mul(out, vertical ? fs * 2.6 : fs * 1.5));
          const amber = wallHl(w.index);
          return (
            <g key={w.index} pointerEvents="none">
              <text
                x={dimP.x}
                y={-dimP.y}
                fontSize={fs * 0.8}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={amber ? C.estimate : C.dim}
                fontWeight={amber ? 700 : 500}
              >
                <tspan fill={C.faint} fontWeight={700}>{`W${w.index}`}</tspan>
                <tspan x={dimP.x} dy={fs * 0.95} textDecoration={amber ? "underline" : undefined} strokeDasharray={amber ? "4 3" : undefined}>
                  {`${Math.round(w.length)} cm${amber ? " (est.)" : ""}`}
                </tspan>
              </text>
            </g>
          );
        })}

        {/* estimated corners */}
        {room.corners.map((c, i) =>
          cornerHl(i) ? (
            <circle key={i} cx={c.x} cy={-c.y} r={fs * 0.6} fill="none" stroke={C.estimate} strokeWidth={fs * 0.15} strokeDasharray={`${fs * 0.3} ${fs * 0.2}`} pointerEvents="none" />
          ) : null,
        )}

        {/* area + ceiling height */}
        <g pointerEvents="none">
          <text x={bb.minX - pad * 0.9} y={-bb.maxY - pad * 0.55} fontSize={fs * 1.05} fill={C.wall} fontWeight={700}>
            {`${area.toFixed(2)} m²`}
            <tspan fontSize={fs * 0.75} fontWeight={500} fill={hl.has("ceilingHeight") ? C.estimate : C.dim}>
              {`  ·  ceiling ${Math.round(room.ceilingHeight)} cm${hl.has("ceilingHeight") ? " (est.)" : ""}`}
            </tspan>
          </text>
        </g>

        {/* compass */}
        <g transform={`translate(${r1(compass.x)} ${r1(-compass.y)}) rotate(${north})`} pointerEvents="none">
          <circle r={fs * 1.4} fill="white" stroke={C.faint} strokeWidth={fs * 0.08} />
          <path d={`M0,${-fs * 1.1} L${fs * 0.45},${fs * 0.5} L0,${fs * 0.2} L${-fs * 0.45},${fs * 0.5} Z`} fill={C.wall} />
          <text y={-fs * 1.65} fontSize={fs * 0.8} textAnchor="middle" fontWeight={700} fill={C.wall}>
            N
          </text>
        </g>
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Feature shapes
// ---------------------------------------------------------------------------

function WallFeatureShape({ room, f, fs, amber }: { room: RoomModel; f: WallFeature; fs: number; amber: boolean }) {
  const w = wallSegment(room, f.wallIndex);
  const { a, b } = featureSegment(room, f);
  const nIn = w.inwardNormal;
  const dash = amber ? `${fs * 0.35} ${fs * 0.25}` : undefined;
  const wallW = Math.max(3, fs * 0.35);
  const mid = addP(a, mul(w.dir, f.width / 2));
  const title = `${f.label ?? f.kind} on W${f.wallIndex}: ${f.width} cm wide, ${f.height} cm high, ${f.z} cm above floor${amber ? " (estimated)" : ""}`;

  switch (f.kind) {
    case "door": {
      const hinge = f.hinge === "end" ? b : a;
      const other = f.hinge === "end" ? a : b;
      const nn = f.opens === "outward" ? mul(nIn, -1) : nIn;
      const tip = addP(hinge, mul(nn, f.width));
      const sweepCw = ((other.x - hinge.x) * nn.y - (other.y - hinge.y) * nn.x) > 0; // in plan coords
      // SVG y is flipped, so the sweep flag is inverted
      const sweep = sweepCw ? 0 : 1;
      const col = amber ? C.estimate : C.door;
      return (
        <g pointerEvents="none">
          <title>{title}</title>
          <line x1={a.x} y1={-a.y} x2={b.x} y2={-b.y} stroke={C.floor} strokeWidth={wallW + 1} />
          <line x1={hinge.x} y1={-hinge.y} x2={tip.x} y2={-tip.y} stroke={col} strokeWidth={fs * 0.15} strokeDasharray={dash} />
          <path
            d={`M${r1(tip.x)},${r1(-tip.y)} A${f.width},${f.width} 0 0 ${sweep} ${r1(other.x)},${r1(-other.y)}`}
            fill="none"
            stroke={col}
            strokeWidth={fs * 0.08}
            strokeDasharray={dash ?? `${fs * 0.3} ${fs * 0.2}`}
          />
        </g>
      );
    }
    case "window": {
      const off = wallW * 0.35;
      const a1 = addP(a, mul(nIn, off));
      const b1 = addP(b, mul(nIn, off));
      const a2 = addP(a, mul(nIn, -off));
      const b2 = addP(b, mul(nIn, -off));
      const col = amber ? C.estimate : C.window;
      return (
        <g pointerEvents="none">
          <title>{title}</title>
          <line x1={a.x} y1={-a.y} x2={b.x} y2={-b.y} stroke="white" strokeWidth={wallW + 1} />
          <line x1={a1.x} y1={-a1.y} x2={b1.x} y2={-b1.y} stroke={col} strokeWidth={fs * 0.12} strokeDasharray={dash} />
          <line x1={a2.x} y1={-a2.y} x2={b2.x} y2={-b2.y} stroke={col} strokeWidth={fs * 0.12} strokeDasharray={dash} />
        </g>
      );
    }
    case "radiator": {
      const depth = Math.max(6, fs * 0.6);
      const off0 = wallW * 0.6;
      const poly = [addP(a, mul(nIn, off0)), addP(b, mul(nIn, off0)), addP(b, mul(nIn, off0 + depth)), addP(a, mul(nIn, off0 + depth))];
      const col = amber ? C.estimate : C.radiator;
      const fins: Point[][] = [];
      const count = Math.max(2, Math.floor(f.width / Math.max(8, fs * 0.8)));
      for (let k = 1; k < count; k++) {
        const p = addP(a, mul(w.dir, (f.width * k) / count));
        fins.push([addP(p, mul(nIn, off0)), addP(p, mul(nIn, off0 + depth))]);
      }
      return (
        <g pointerEvents="none">
          <title>{title}</title>
          <polygon points={pts(poly)} fill="#ffedd5" stroke={col} strokeWidth={fs * 0.1} strokeDasharray={dash} />
          {fins.map(([p, q], i) => (
            <line key={i} x1={p.x} y1={-p.y} x2={q.x} y2={-q.y} stroke={col} strokeWidth={fs * 0.05} />
          ))}
        </g>
      );
    }
    case "socket":
    case "switch":
    case "connection": {
      const r = Math.max(4, fs * 0.38);
      const c = addP(mid, mul(nIn, wallW * 0.5 + r * 1.2));
      const col = amber ? C.estimate : C.electric;
      const sc = S(c);
      return (
        <g pointerEvents="none">
          <title>{title}</title>
          {f.kind === "socket" && (
            <>
              <circle cx={sc.x} cy={sc.y} r={r} fill="white" stroke={col} strokeWidth={fs * 0.08} strokeDasharray={dash} />
              <circle cx={sc.x - r * 0.38} cy={sc.y} r={r * 0.15} fill={col} />
              <circle cx={sc.x + r * 0.38} cy={sc.y} r={r * 0.15} fill={col} />
            </>
          )}
          {f.kind === "switch" && (
            <>
              <circle cx={sc.x} cy={sc.y} r={r * 0.8} fill="white" stroke={col} strokeWidth={fs * 0.08} strokeDasharray={dash} />
              <line x1={sc.x - r * 0.5} y1={sc.y + r * 0.5} x2={sc.x + r * 0.5} y2={sc.y - r * 0.5} stroke={col} strokeWidth={fs * 0.08} />
            </>
          )}
          {f.kind === "connection" && (
            <rect x={sc.x - r * 0.75} y={sc.y - r * 0.75} width={r * 1.5} height={r * 1.5} fill="white" stroke={col} strokeWidth={fs * 0.08} strokeDasharray={dash} />
          )}
        </g>
      );
    }
    case "builtIn": {
      const depth = f.depth && f.depth > 0 ? f.depth : 10;
      const poly = [a, b, addP(b, mul(nIn, depth)), addP(a, mul(nIn, depth))];
      return (
        <g pointerEvents="none">
          <title>{title}</title>
          <polygon points={pts(poly)} fill="#e2e8f0" stroke={amber ? C.estimate : C.wall} strokeWidth={fs * 0.1} strokeDasharray={dash} />
          {f.label && (
            <text x={addP(mid, mul(nIn, depth / 2)).x} y={-addP(mid, mul(nIn, depth / 2)).y} fontSize={fs * 0.55} textAnchor="middle" dominantBaseline="middle" fill={C.dim}>
              {f.label}
            </text>
          )}
        </g>
      );
    }
    default:
      return null;
  }
}

function CeilingFeatureShape({ room, c, fs, amber }: { room: RoomModel; c: CeilingFeature; fs: number; amber: boolean }) {
  const dash = `${fs * 0.35} ${fs * 0.25}`;
  if (c.kind === "ceilingLight") {
    const r = Math.max(5, fs * 0.55);
    const col = amber ? C.estimate : C.light;
    return (
      <g pointerEvents="none">
        <title>{`${c.label ?? "Ceiling light"}${amber ? " (estimated position)" : ""}`}</title>
        <circle cx={c.x} cy={-c.y} r={r} fill="#fefce8" stroke={col} strokeWidth={fs * 0.1} strokeDasharray={amber ? dash : undefined} />
        <line x1={c.x - r * 0.7} y1={-c.y - r * 0.7} x2={c.x + r * 0.7} y2={-c.y + r * 0.7} stroke={col} strokeWidth={fs * 0.08} />
        <line x1={c.x - r * 0.7} y1={-c.y + r * 0.7} x2={c.x + r * 0.7} y2={-c.y - r * 0.7} stroke={col} strokeWidth={fs * 0.08} />
      </g>
    );
  }
  // roof window: oriented along the slope it sits in (width along the wall, length projected)
  const width = c.width ?? 78;
  const length = c.length ?? 118;
  let along: Point = { x: 1, y: 0 };
  let across: Point = { x: 0, y: 1 };
  let projected = length;
  for (const s of room.slopes) {
    if (s.wallIndex < 1 || s.wallIndex > room.corners.length) continue;
    const w = wallSegment(room, s.wallIndex);
    const d = (c.x - w.a.x) * w.inwardNormal.x + (c.y - w.a.y) * w.inwardNormal.y;
    if (d < -1 || d > s.fullHeightDistance + 1) continue;
    along = w.dir;
    across = w.inwardNormal;
    const rise = Math.max(0, room.ceilingHeight - s.kneeWallHeight);
    projected = s.fullHeightDistance > 0 ? length * (s.fullHeightDistance / Math.hypot(s.fullHeightDistance, rise)) : length;
    break;
  }
  const ctr = { x: c.x, y: c.y };
  const hw = mul(along, width / 2);
  const hl = mul(across, projected / 2);
  const poly = [addP(addP(ctr, mul(hw, -1)), mul(hl, -1)), addP(addP(ctr, hw), mul(hl, -1)), addP(addP(ctr, hw), hl), addP(addP(ctr, mul(hw, -1)), hl)];
  const col = amber ? C.estimate : C.roofWindow;
  return (
    <g pointerEvents="none">
      <title>{`Roof window${c.typeCode ? ` ${c.typeCode}` : ""}: ${width} × ${length} cm${c.lowerEdgeZ ? `, lower edge ${c.lowerEdgeZ} cm` : ""}${amber ? " (estimated)" : ""}`}</title>
      <polygon points={pts(poly)} fill="#e0f2fe" fillOpacity={0.35} stroke={col} strokeWidth={fs * 0.12} strokeDasharray={amber ? dash : undefined} />
      <line x1={poly[0].x} y1={-poly[0].y} x2={poly[2].x} y2={-poly[2].y} stroke={col} strokeWidth={fs * 0.05} />
      <line x1={poly[1].x} y1={-poly[1].y} x2={poly[3].x} y2={-poly[3].y} stroke={col} strokeWidth={fs * 0.05} />
      {c.typeCode && (
        <text x={c.x} y={-c.y} fontSize={fs * 0.55} textAnchor="middle" dominantBaseline="middle" fill="#075985" paintOrder="stroke" stroke="#e0f2fe" strokeWidth={fs * 0.2}>
          {c.typeCode}
        </text>
      )}
    </g>
  );
}
