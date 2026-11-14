"use client";

import { defaultTemplateParams, templateToCorners, validatePolygon } from "@/lib/geometry";
import { newId } from "@/lib/db";
import type { CeilingFeature, EstimateInfo, RoomModel, RoomTemplateKind, Slope, WallFeature, WallFeatureKind } from "@/lib/types";
import { Badge, Button, CmInput, EstimateTag, NumInput, Select, TextInput } from "../ui";

const TEMPLATE_LABEL: Record<RoomTemplateKind, string> = {
  rectangle: "Rectangle",
  lShape: "L-shape",
  rectNiche: "Rectangle + niche",
  uShape: "U-shape",
  custom: "Custom (corner table)",
};

const PARAM_LABEL: Record<string, string> = {
  width: "Width (west→east)",
  depth: "Depth (south→north)",
  cutWidth: "Cut-out width",
  cutDepth: "Cut-out depth",
  nicheWall: "Niche on wall (1 W, 2 N, 3 E, 4 S)",
  nicheOffset: "Niche offset from wall start",
  nicheWidth: "Niche width",
  nicheDepth: "Niche depth",
  gapWidth: "Notch width",
  gapDepth: "Notch depth",
  gapOffset: "Notch offset from west",
};

const FEATURE_LABEL: Record<WallFeatureKind, string> = {
  door: "Door",
  window: "Window",
  radiator: "Radiator",
  socket: "Socket",
  switch: "Light switch",
  connection: "Network/TV",
  builtIn: "Built-in (niche, column…)",
};

const FEATURE_DEFAULTS: Record<WallFeatureKind, Partial<WallFeature>> = {
  door: { width: 80, height: 200, z: 0, hinge: "start", opens: "inward" },
  window: { width: 100, height: 120, z: 90, opening: "tilt-turn" },
  radiator: { width: 100, height: 60, z: 15 },
  socket: { width: 8, height: 8, z: 30 },
  switch: { width: 8, height: 8, z: 105 },
  connection: { width: 8, height: 8, z: 30, connectionType: "network" },
  builtIn: { width: 60, height: 250, z: 0, depth: 40 },
};

export function emptyModel(): RoomModel {
  const params = defaultTemplateParams("rectangle");
  return {
    version: 1,
    corners: templateToCorners({ kind: "rectangle", params }),
    northAngle: 0,
    ceilingHeight: 250,
    slopes: [],
    wallFeatures: [],
    ceilingFeatures: [],
    template: { kind: "rectangle", params },
    estimates: { corners: { source: "default" }, ceilingHeight: { source: "default" } },
  };
}

/** Marks paths as user-entered (removing estimate/default info) and bumps the model version. */
function markUser(m: RoomModel, paths: string[]): RoomModel {
  const estimates = { ...m.estimates };
  for (const p of paths) {
    for (const k of Object.keys(estimates)) if (k === p || k.startsWith(p + ".")) delete estimates[k];
    estimates[p] = { source: "user" } satisfies EstimateInfo;
  }
  return { ...m, estimates, version: m.version + 1 };
}

export function RoomModelEditor({ model, onChange }: { model: RoomModel; onChange: (m: RoomModel) => void }) {
  const est = (p: string) => model.estimates[p];
  const walls = model.corners.map((_, i) => i + 1);
  const wallOptions = walls.map((w) => ({ value: String(w), label: `W${w}` }));
  const poly = validatePolygon(model.corners);
  const tKind: RoomTemplateKind = model.template?.kind ?? "custom";

  const setTemplate = (kind: RoomTemplateKind) => {
    if (kind === "custom") return onChange(markUser({ ...model, template: { kind: "custom", params: {} } }, ["template"]));
    const params = defaultTemplateParams(kind);
    onChange(markUser({ ...model, template: { kind, params }, corners: templateToCorners({ kind, params }) }, ["template", "corners"]));
  };
  const setParam = (k: string, v: number) => {
    const params = { ...(model.template?.params ?? {}), [k]: v };
    onChange(markUser({ ...model, template: { kind: tKind, params }, corners: templateToCorners({ kind: tKind, params }) }, ["template", "corners"]));
  };
  const setCorner = (i: number, axis: "x" | "y", v: number) => {
    const corners = model.corners.map((c, j) => (j === i ? { ...c, [axis]: v } : c));
    onChange(markUser({ ...model, corners, template: { kind: "custom", params: {} } }, [`corners.${i}.${axis}`, "corners"]));
  };
  const setWf = (f: WallFeature, patch: Partial<WallFeature>) =>
    onChange(markUser({ ...model, wallFeatures: model.wallFeatures.map((x) => (x.id === f.id ? { ...x, ...patch } : x)) }, Object.keys(patch).map((k) => `wallFeatures.${f.id}.${k}`)));
  const setCf = (f: CeilingFeature, patch: Partial<CeilingFeature>) =>
    onChange(markUser({ ...model, ceilingFeatures: model.ceilingFeatures.map((x) => (x.id === f.id ? { ...x, ...patch } : x)) }, Object.keys(patch).map((k) => `ceilingFeatures.${f.id}.${k}`)));
  const setSlope = (s: Slope, patch: Partial<Slope>) =>
    onChange(markUser({ ...model, slopes: model.slopes.map((x) => (x.id === s.id ? { ...x, ...patch } : x)) }, Object.keys(patch).map((k) => `slopes.${s.id}.${k}`)));

  return (
    <div className="space-y-6">
      {/* Shape */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-stone-800">Room shape</h3>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <span className="mb-1 block text-xs text-stone-500">Template</span>
            <Select<RoomTemplateKind> value={tKind} onChange={setTemplate} options={(Object.keys(TEMPLATE_LABEL) as RoomTemplateKind[]).map((k) => ({ value: k, label: TEMPLATE_LABEL[k] }))} />
          </div>
          {tKind !== "custom" &&
            Object.entries(model.template?.params ?? {}).map(([k, v]) => (
              <div key={k}>
                <span className="mb-1 block text-xs text-stone-500">{PARAM_LABEL[k] ?? k}</span>
                {k === "nicheWall" ? (
                  <Select value={String(v)} onChange={(x) => setParam(k, Number(x))} options={["1", "2", "3", "4"].map((w) => ({ value: w, label: `W${w}` }))} />
                ) : (
                  <CmInput value={v} min={10} max={3000} onChange={(x) => setParam(k, x)} estimate={est("corners")} ariaLabel={PARAM_LABEL[k] ?? k} />
                )}
              </div>
            ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          {poly.ok ? <Badge tone="green">valid outline · {poly.areaM2.toFixed(2)} m²</Badge> : <Badge tone="red">{poly.errors.join(" ")}</Badge>}
          <EstimateTag info={est("corners")} />
        </div>
        <details className="mt-3" open={tKind === "custom"}>
          <summary className="cursor-pointer text-xs font-medium text-stone-600">Corner points (expert table, clockwise from above, C0 = south-west)</summary>
          <table className="mt-2 text-sm">
            <tbody>
              {model.corners.map((c, i) => (
                <tr key={i}>
                  <td className="pr-2 text-stone-500">C{i}</td>
                  <td className="pr-2">
                    x <CmInput value={c.x} min={0} max={5000} allowNegative onChange={(v) => setCorner(i, "x", v)} estimate={est(`corners.${i}.x`)} />
                  </td>
                  <td className="pr-2">
                    y <CmInput value={c.y} min={0} max={5000} allowNegative onChange={(v) => setCorner(i, "y", v)} estimate={est(`corners.${i}.y`)} />
                  </td>
                  <td>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={model.corners.length <= 3}
                      onClick={() => onChange(markUser({ ...model, corners: model.corners.filter((_, j) => j !== i), template: { kind: "custom", params: {} } }, ["corners"]))}
                    >
                      ✕
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Button size="sm" className="mt-1" onClick={() => onChange(markUser({ ...model, corners: [...model.corners, { ...model.corners[model.corners.length - 1] }], template: { kind: "custom", params: {} } }, ["corners"]))}>
            + corner
          </Button>
        </details>
      </section>

      {/* Ceiling */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-stone-800">Ceiling & orientation</h3>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <span className="mb-1 block text-xs text-stone-500">Ceiling height</span>
            <div className="flex items-center gap-1">
              <CmInput value={model.ceilingHeight} min={150} max={800} onChange={(v) => onChange(markUser({ ...model, ceilingHeight: v }, ["ceilingHeight"]))} estimate={est("ceilingHeight")} ariaLabel="Ceiling height" />
              <EstimateTag info={est("ceilingHeight")} />
            </div>
          </div>
          <div>
            <span className="mb-1 block text-xs text-stone-500">North angle (bearing of +y, °)</span>
            <NumInput ariaLabel="North angle" value={model.northAngle} onChange={(v) => onChange(markUser({ ...model, northAngle: ((v % 360) + 360) % 360 }, ["northAngle"]))} />
          </div>
          <div>
            <span className="mb-1 block text-xs text-stone-500">Wall colour</span>
            <TextInput value={model.wallColor ?? ""} onChange={(e) => onChange(markUser({ ...model, wallColor: e.target.value }, ["wallColor"]))} />
          </div>
          <div>
            <span className="mb-1 block text-xs text-stone-500">Floor</span>
            <TextInput value={model.floorType ?? ""} placeholder="e.g. oak-look laminate" onChange={(e) => onChange(markUser({ ...model, floorType: e.target.value }, ["floorType"]))} />
          </div>
        </div>
        <div className="mt-3 space-y-2">
          {model.slopes.map((s) => (
            <div key={s.id} className="flex flex-wrap items-end gap-3 rounded-lg bg-stone-50 p-2">
              <span className="text-sm font-medium">Sloped ceiling</span>
              <label className="text-xs text-stone-500">
                starts at wall
                <Select value={String(s.wallIndex)} onChange={(v) => setSlope(s, { wallIndex: Number(v) })} options={wallOptions} className="mt-1 w-20" />
              </label>
              <label className="text-xs text-stone-500">
                knee-wall height
                <CmInput value={s.kneeWallHeight} min={0} max={400} onChange={(v) => setSlope(s, { kneeWallHeight: v })} estimate={est(`slopes.${s.id}.kneeWallHeight`)} />
              </label>
              <label className="text-xs text-stone-500">
                full height reached after
                <CmInput value={s.fullHeightDistance} min={1} max={2000} onChange={(v) => setSlope(s, { fullHeightDistance: v })} estimate={est(`slopes.${s.id}.fullHeightDistance`)} />
              </label>
              <Button size="sm" variant="ghost" onClick={() => onChange(markUser({ ...model, slopes: model.slopes.filter((x) => x.id !== s.id) }, ["slopes"]))}>
                ✕
              </Button>
            </div>
          ))}
          <Button size="sm" onClick={() => onChange(markUser({ ...model, slopes: [...model.slopes, { id: newId(), wallIndex: 2, kneeWallHeight: 100, fullHeightDistance: 160 }] }, ["slopes"]))}>
            + sloped ceiling
          </Button>
        </div>
      </section>

      {/* Wall features */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-stone-800">Doors, windows, radiators, sockets & built-ins</h3>
        <p className="mb-2 text-xs text-stone-500">Offset = distance from the wall&apos;s start corner to the feature&apos;s nearer edge. Height above floor = bottom edge.</p>
        <div className="overflow-x-auto">
          <table className="text-sm">
            <thead>
              <tr className="text-left text-xs text-stone-500">
                <th className="pr-2">Type</th>
                <th className="pr-2">Wall</th>
                <th className="pr-2">Offset</th>
                <th className="pr-2">Width</th>
                <th className="pr-2">Above floor</th>
                <th className="pr-2">Height</th>
                <th className="pr-2">Details</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {model.wallFeatures.map((f) => {
                const e = (k: string) => est(`wallFeatures.${f.id}.${k}`);
                return (
                  <tr key={f.id} className="border-t border-stone-100 align-top">
                    <td className="py-1 pr-2">
                      <Select<WallFeatureKind> value={f.kind} onChange={(k) => setWf(f, { kind: k, ...FEATURE_DEFAULTS[k] })} options={(Object.keys(FEATURE_LABEL) as WallFeatureKind[]).map((k) => ({ value: k, label: FEATURE_LABEL[k] }))} />
                    </td>
                    <td className="py-1 pr-2">
                      <Select value={String(f.wallIndex)} onChange={(v) => setWf(f, { wallIndex: Number(v) })} options={wallOptions} className="w-20" />
                    </td>
                    <td className="py-1 pr-2">
                      <CmInput value={f.offset} min={0} max={5000} onChange={(v) => setWf(f, { offset: v })} estimate={e("offset")} />
                    </td>
                    <td className="py-1 pr-2">
                      <CmInput value={f.width} min={1} max={2000} onChange={(v) => setWf(f, { width: v })} estimate={e("width")} />
                    </td>
                    <td className="py-1 pr-2">
                      <CmInput value={f.z} min={0} max={500} onChange={(v) => setWf(f, { z: v })} estimate={e("z")} />
                    </td>
                    <td className="py-1 pr-2">
                      <CmInput value={f.height} min={1} max={800} onChange={(v) => setWf(f, { height: v })} estimate={e("height")} />
                    </td>
                    <td className="py-1 pr-2">
                      {f.kind === "door" && (
                        <div className="flex gap-1">
                          <Select value={f.hinge ?? "start"} onChange={(v) => setWf(f, { hinge: v as WallFeature["hinge"] })} options={[{ value: "start", label: "hinge at start side" }, { value: "end", label: "hinge at end side" }]} />
                          <Select value={f.opens ?? "inward"} onChange={(v) => setWf(f, { opens: v as WallFeature["opens"] })} options={[{ value: "inward", label: "opens inward" }, { value: "outward", label: "opens outward" }]} />
                        </div>
                      )}
                      {f.kind === "window" && (
                        <Select
                          value={f.opening ?? "tilt-turn"}
                          onChange={(v) => setWf(f, { opening: v as WallFeature["opening"] })}
                          options={["tilt-turn", "casement", "fixed", "sliding", "other"].map((o) => ({ value: o, label: o }))}
                        />
                      )}
                      {f.kind === "connection" && (
                        <Select value={f.connectionType ?? "network"} onChange={(v) => setWf(f, { connectionType: v as WallFeature["connectionType"] })} options={[{ value: "network", label: "network" }, { value: "tv", label: "TV" }, { value: "other", label: "other" }]} />
                      )}
                      {f.kind === "builtIn" && (
                        <span className="flex items-center gap-1 text-xs">
                          depth <CmInput value={f.depth ?? 40} min={1} max={500} onChange={(v) => setWf(f, { depth: v })} />
                          <TextInput className="w-28" placeholder="label" value={f.label ?? ""} onChange={(ev) => setWf(f, { label: ev.target.value })} />
                        </span>
                      )}
                    </td>
                    <td className="py-1">
                      <Button size="sm" variant="ghost" onClick={() => onChange(markUser({ ...model, wallFeatures: model.wallFeatures.filter((x) => x.id !== f.id) }, ["wallFeatures"]))}>
                        ✕
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {(Object.keys(FEATURE_LABEL) as WallFeatureKind[]).map((k) => (
            <Button
              key={k}
              size="sm"
              onClick={() => {
                const id = newId();
                onChange(markUser({ ...model, wallFeatures: [...model.wallFeatures, { id, kind: k, wallIndex: 1, offset: 20, width: 80, z: 0, height: 100, ...FEATURE_DEFAULTS[k] }] }, [`wallFeatures.${id}`]));
              }}
            >
              + {FEATURE_LABEL[k]}
            </Button>
          ))}
        </div>
      </section>

      {/* Ceiling features */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-stone-800">Roof windows & ceiling lights</h3>
        <div className="space-y-2">
          {model.ceilingFeatures.map((c) => {
            const e = (k: string) => est(`ceilingFeatures.${c.id}.${k}`);
            return (
              <div key={c.id} className="flex flex-wrap items-end gap-3 rounded-lg bg-stone-50 p-2 text-xs text-stone-500">
                <span className="text-sm font-medium text-stone-800">{c.kind === "roofWindow" ? "Roof window" : "Ceiling light"}</span>
                <label>
                  centre x <CmInput value={c.x} min={0} max={5000} onChange={(v) => setCf(c, { x: v })} estimate={e("x")} />
                </label>
                <label>
                  centre y <CmInput value={c.y} min={0} max={5000} onChange={(v) => setCf(c, { y: v })} estimate={e("y")} />
                </label>
                {c.kind === "roofWindow" && (
                  <>
                    <label>
                      width <CmInput value={c.width ?? 78} min={1} max={500} onChange={(v) => setCf(c, { width: v })} estimate={e("width")} />
                    </label>
                    <label>
                      length <CmInput value={c.length ?? 118} min={1} max={500} onChange={(v) => setCf(c, { length: v })} estimate={e("length")} />
                    </label>
                    <label>
                      lower edge above floor <CmInput value={c.lowerEdgeZ ?? 100} min={0} max={800} onChange={(v) => setCf(c, { lowerEdgeZ: v })} estimate={e("lowerEdgeZ")} />
                    </label>
                    <label>
                      type-plate code
                      <TextInput className="mt-1 w-28" placeholder="e.g. GGL MK06" value={c.typeCode ?? ""} onChange={(ev) => setCf(c, { typeCode: ev.target.value })} />
                    </label>
                  </>
                )}
                <Button size="sm" variant="ghost" onClick={() => onChange(markUser({ ...model, ceilingFeatures: model.ceilingFeatures.filter((x) => x.id !== c.id) }, ["ceilingFeatures"]))}>
                  ✕
                </Button>
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex gap-1">
          <Button
            size="sm"
            onClick={() => {
              const id = newId();
              onChange(markUser({ ...model, ceilingFeatures: [...model.ceilingFeatures, { id, kind: "roofWindow", x: 100, y: 100, width: 78, length: 118, lowerEdgeZ: 120 }] }, [`ceilingFeatures.${id}`]));
            }}
          >
            + roof window
          </Button>
          <Button
            size="sm"
            onClick={() => {
              const id = newId();
              onChange(markUser({ ...model, ceilingFeatures: [...model.ceilingFeatures, { id, kind: "ceilingLight", x: 100, y: 100 }] }, [`ceilingFeatures.${id}`]));
            }}
          >
            + ceiling light
          </Button>
        </div>
      </section>
    </div>
  );
}

/** Paths of estimated values (for highlighting in the 2D view). */
export function estimatedPaths(m: RoomModel): string[] {
  return Object.entries(m.estimates)
    .filter(([, e]) => e.source === "estimated" || e.source === "default")
    .map(([p]) => p);
}

export function hasRealMeasurement(m: RoomModel | null): boolean {
  if (!m) return false;
  return Object.values(m.estimates).some((e) => e.source === "user");
}
