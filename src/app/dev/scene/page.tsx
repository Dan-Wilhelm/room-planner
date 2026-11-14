"use client";

/** Dev preview of the 3D room view with the reference test room and a sample layout. */
import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { PlacedItem, RoomModel } from "@/lib/types";
import type { CameraState, RoomSceneHandle } from "@/components/three/RoomScene";

const RoomScene = dynamic(() => import("@/components/three/RoomScene"), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-stone-500">Loading 3D view…</div>,
});

const TEST_ROOM: RoomModel = {
  version: 1,
  corners: [
    { x: 0, y: 0 },
    { x: 0, y: 360 },
    { x: 420, y: 360 },
    { x: 420, y: 150 },
    { x: 540, y: 150 },
    { x: 540, y: 0 },
  ],
  northAngle: 0,
  ceilingHeight: 250,
  slopes: [{ id: "s1", wallIndex: 2, kneeWallHeight: 100, fullHeightDistance: 160 }],
  wallFeatures: [
    { id: "door", kind: "door", wallIndex: 6, offset: 400, width: 80, z: 0, height: 200, hinge: "end", opens: "inward" },
    { id: "win", kind: "window", wallIndex: 5, offset: 25, width: 100, z: 90, height: 120, opening: "tilt-turn" },
    { id: "rad", kind: "radiator", wallIndex: 5, offset: 25, width: 100, z: 15, height: 60 },
    { id: "sock1", kind: "socket", wallIndex: 3, offset: 20, width: 8, z: 30, height: 8 },
    { id: "sock2", kind: "socket", wallIndex: 3, offset: 190, width: 8, z: 30, height: 8 },
  ],
  ceilingFeatures: [
    { id: "rw", kind: "roofWindow", x: 210, y: 339, width: 78, length: 118, lowerEdgeZ: 120, typeCode: "GGL MK06" },
    { id: "cl", kind: "ceilingLight", x: 210, y: 180 },
  ],
  wallColor: "white",
  floorType: "oak-look laminate",
  estimates: {},
};

const inv = (id: string) => ({ type: "inventory" as const, inventoryId: id });

const SAMPLE_ITEMS: PlacedItem[] = [
  {
    id: "bed",
    ref: inv("bed"),
    category: "bed",
    label: "Bed 140×200",
    x: 100,
    y: 250,
    rotation: 90,
    w: 140,
    d: 200,
    h: 90,
    colorHex: "#8f7f6c",
    material: "upholstered fabric",
  },
  {
    id: "nightstand",
    ref: inv("ns"),
    category: "nightstand",
    label: "Nightstand",
    x: 22,
    y: 155,
    rotation: 90,
    w: 45,
    d: 40,
    h: 55,
    material: "oak",
  },
  {
    id: "rug",
    ref: inv("rug"),
    category: "rug",
    label: "Rug 160×230",
    x: 130,
    y: 250,
    rotation: 90,
    w: 160,
    d: 230,
    h: 1,
    colorHex: "#b9a68c",
  },
  {
    id: "desk",
    ref: inv("desk"),
    category: "desk",
    label: "Desk",
    x: 495,
    y: 75,
    rotation: 270,
    w: 120,
    d: 60,
    h: 75,
    material: "oak veneer",
  },
  {
    id: "chair",
    ref: inv("chair"),
    category: "deskChair",
    label: "Desk chair",
    x: 440,
    y: 75,
    rotation: 90,
    w: 60,
    d: 60,
    h: 100,
    colorHex: "#3d3d3d",
  },
  {
    id: "wardrobe",
    ref: inv("wardrobe"),
    category: "wardrobe",
    label: "Wardrobe",
    x: 389,
    y: 205,
    rotation: 270,
    w: 100,
    d: 60,
    h: 200,
    colorHex: "#efede7",
  },
  {
    id: "floorlamp",
    ref: inv("fl"),
    category: "floorLamp",
    label: "Floor lamp 2700 K",
    x: 300,
    y: 30,
    rotation: 0,
    w: 40,
    d: 40,
    h: 160,
    kelvin: 2700,
    lumens: 800,
  },
  {
    id: "pendant",
    ref: { type: "slot", slotId: "pendant" },
    category: "pendantLamp",
    label: "Pendant",
    x: 210,
    y: 180,
    rotation: 0,
    w: 40,
    d: 40,
    h: 30,
    mount: "ceiling",
    kelvin: 2700,
    colorHex: "#2f3a33",
  },
  {
    id: "plant",
    ref: { type: "slot", slotId: "plant" },
    category: "plant",
    label: "Plant",
    x: 395,
    y: 125,
    rotation: 0,
    w: 45,
    d: 45,
    h: 110,
    colorHex: "#c46a4b",
  },
  {
    id: "curtain",
    ref: { type: "slot", slotId: "curtain" },
    category: "curtain",
    label: "Curtain",
    x: 533,
    y: 75,
    rotation: 270,
    w: 160,
    d: 10,
    h: 240,
    z: 0,
    colorHex: "#e9e2d3",
  },
];

/** Robustness cases: a plain rectangle without slopes or items, and deliberately broken input. */
const PLAIN_ROOM: RoomModel = {
  version: 1,
  corners: [
    { x: 0, y: 0 },
    { x: 0, y: 300 },
    { x: 400, y: 300 },
    { x: 400, y: 0 },
  ],
  northAngle: 30,
  ceilingHeight: 260,
  slopes: [],
  wallFeatures: [{ id: "d", kind: "door", wallIndex: 4, offset: 20, width: 90, z: 0, height: 210 }],
  ceilingFeatures: [],
  estimates: {},
};

const BROKEN_ROOM = {
  version: 1,
  corners: [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 300, y: 0 },
    { x: NaN, y: 5 },
  ],
  northAngle: NaN,
  ceilingHeight: -5,
  slopes: [{ id: "bad", wallIndex: 99, kneeWallHeight: 300, fullHeightDistance: 0 }],
  wallFeatures: [{ id: "f", kind: "window", wallIndex: 0, offset: -50, width: 9999, z: 0, height: 0 }],
  ceilingFeatures: [{ id: "c", kind: "roofWindow", x: NaN, y: 2 }],
  estimates: {},
} as unknown as RoomModel;

const BROKEN_ITEMS = [
  { id: "n", ref: inv("n"), category: "sofa", label: "NaN sofa", x: NaN, y: 10, rotation: 0, w: 200, d: 90, h: 80 },
  { id: "z", ref: inv("z"), category: "wardrobe", label: "Zero", x: 100, y: 100, rotation: NaN, w: 0, d: 0, h: 0 },
  { id: "u", ref: inv("u"), category: "unknownThing", label: "Unknown category", x: 200, y: 100, rotation: 45, w: 50, d: 50, h: 50 },
] as unknown as PlacedItem[];

const CASES = {
  test: { room: TEST_ROOM, items: SAMPLE_ITEMS },
  plain: { room: PLAIN_ROOM, items: [] as PlacedItem[] },
  broken: { room: BROKEN_ROOM, items: BROKEN_ITEMS },
} as const;

export default function DevScenePage() {
  const [sceneCase, setSceneCase] = useState<keyof typeof CASES>("test");
  const [preset, setPreset] = useState<"perspective" | "top">("perspective");
  const [labels, setLabels] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [cam, setCam] = useState<CameraState | undefined>(undefined);
  const [shot, setShot] = useState<{ url: string; size: number } | null>(null);
  const [paint, setPaint] = useState(false);
  const captureRef = useRef<RoomSceneHandle>(null);

  async function capture() {
    const blob = await captureRef.current?.capture({ width: 960 });
    if (!blob) return;
    setShot((old) => {
      if (old) URL.revokeObjectURL(old.url);
      return { url: URL.createObjectURL(blob), size: blob.size };
    });
  }

  const btn = "rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-800 hover:bg-stone-50";
  return (
    <main className="flex flex-col gap-3 bg-stone-100 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-4 text-lg font-semibold text-stone-900">3D scene preview</h1>
        <button data-testid="preset-perspective" className={btn} onClick={() => setPreset("perspective")}>
          Perspective
        </button>
        <button data-testid="preset-top" className={btn} onClick={() => setPreset("top")}>
          Top
        </button>
        <button data-testid="toggle-labels" className={btn} onClick={() => setLabels((v) => !v)}>
          Labels: {labels ? "on" : "off"}
        </button>
        <button data-testid="toggle-paint" className={btn} onClick={() => setPaint((v) => !v)}>
          Paint W2 + slope: {paint ? "on" : "off"}
        </button>
        <button
          data-testid="view-door"
          className={btn}
          onClick={() => setCam({ position: [3.2, 1.6, -0.4], target: [1.6, 1.3, -3.2] })}
        >
          View from door (controlled camera)
        </button>
        <button data-testid="capture" className={btn} onClick={capture}>
          Capture
        </button>
        {(Object.keys(CASES) as (keyof typeof CASES)[]).map((k) => (
          <button key={k} data-testid={`case-${k}`} className={btn} onClick={() => setSceneCase(k)}>
            Case: {k}
            {sceneCase === k ? " ✓" : ""}
          </button>
        ))}
        <span data-testid="selection" className="text-sm text-stone-600">
          Selected: {selected ?? "—"}
        </span>
      </div>
      <div className="h-[620px] overflow-hidden rounded-lg bg-white ring-1 ring-stone-200" data-testid="scene">
        <RoomScene
          room={CASES[sceneCase].room}
          items={CASES[sceneCase].items}
          selectedId={selected}
          onSelect={setSelected}
          cameraPreset={preset}
          camera={cam}
          onCameraChange={setCam}
          captureRef={captureRef}
          showLabels={labels}
          paintedWalls={paint ? ["W2", "slope:s1"] : []}
          paintHex="#9caf88"
          className="h-full w-full"
        />
      </div>
      <p className="text-xs text-stone-500" data-testid="camera">
        Camera: {cam ? `pos ${cam.position.join(", ")} → target ${cam.target.join(", ")}` : "—"}
      </p>
      {shot && (
        <div>
          <p className="text-sm text-stone-600" data-testid="capture-info">
            Captured JPEG: {Math.round(shot.size / 1024)} KB
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img data-testid="capture-img" src={shot.url} alt="Captured view" className="mt-1 max-w-full rounded ring-1 ring-stone-200" />
        </div>
      )}
    </main>
  );
}
