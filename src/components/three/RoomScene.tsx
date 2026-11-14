"use client";

/**
 * Interactive 3D view of a room with placed furniture (react-three-fiber).
 *
 * Mapping plan (cm, x east, y north) → world (metres, Y up):
 *   world.x = plan.x / 100, world.z = −plan.y / 100 (north = −z), world.y = height / 100.
 * Item rotation (clockwise from above, degrees) → rotation.y = −rotation·π/180.
 *
 * Interior visibility: walls and sloped ceilings are single-sided, facing into the room, so any
 * wall between the camera and the interior is back-face culled ("dollhouse" cut-away). No flat
 * ceiling is drawn; an invisible shadow-only ceiling keeps the sun from lighting the floor
 * through the missing roof, so sunlight enters only through windows.
 */
import {
  Suspense,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  type ComponentRef,
  type ReactNode,
  type Ref,
} from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Line, OrbitControls } from "@react-three/drei";
import type { CeilingFeature, PlacedItem, Point, RoomModel, WallFeature } from "@/lib/types";
import { kelvinToHex, mixHex, namedColorToHex, normalizeHex } from "@/lib/color";
import {
  analyzeRoom,
  ceilingHeightAt,
  flatCeilingRegion,
  offsetPolygon,
  pointInPolygon,
  profileMinBetween,
  slopeDistance,
  slopeRegion,
  wallTopProfile,
  type RoomAnalysis,
  type SlopeInfo,
  type WallInfo,
} from "./roomGeometry";
import { FurnitureMesh, itemBaseZ, LIGHT_CATEGORIES } from "./furniture";
import { getFloorTexture } from "./textures";

export interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
}

export interface RoomSceneHandle {
  /** Renders the current view and returns it as a JPEG (quality 0.85). `width` downscales (keeps aspect). */
  capture: (opts?: { width?: number }) => Promise<Blob>;
}

export interface RoomSceneProps {
  room: RoomModel;
  items: PlacedItem[];
  /** Default: namedColorToHex(room.wallColor ?? "white"). */
  wallColorHex?: string;
  /** Surfaces painted with paintHex: "W1".."Wn" or "slope:<slopeId>". */
  paintedWalls?: string[];
  paintHex?: string;
  /** Default: room.floorType. "oak-look laminate", "parquet", "tiles", "carpet", … */
  floorType?: string;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  cameraPreset?: "perspective" | "top";
  /** Controlled camera (keep the same view across designs). */
  camera?: CameraState;
  /** Throttled (~150 ms) camera updates while the user orbits/zooms/pans. */
  onCameraChange?: (cam: CameraState) => void;
  captureRef?: Ref<RoomSceneHandle>;
  className?: string;
  showLabels?: boolean;
}

const UP = new THREE.Vector3(0, 1, 0);
const CAMERA_FOV = 34;
/** Narrow field of view for the top preset: nearly orthographic, little wall distortion. */
const TOP_FOV = 12;
const presetFov = (p: "perspective" | "top") => (p === "top" ? TOP_FOV : CAMERA_FOV);
const WALL_THICKNESS = 0.2; // visual depth of window/door reveals (m)
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function planToWorld(p: Point, hCm = 0): THREE.Vector3 {
  return V(p.x / 100, hCm / 100, -p.y / 100);
}

function finiteNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export default function RoomScene(props: RoomSceneProps) {
  const {
    room,
    items,
    wallColorHex,
    paintedWalls,
    paintHex,
    floorType,
    selectedId = null,
    onSelect,
    cameraPreset = "perspective",
    camera,
    onCameraChange,
    captureRef,
    className,
    showLabels = false,
  } = props;

  const ra = useMemo(() => analyzeRoom(room), [room]);
  const wallHex = normalizeHex(wallColorHex) ?? namedColorToHex(room?.wallColor ?? "white");
  const paint = normalizeHex(paintHex) ?? null;
  const paintedKey = (paintedWalls ?? []).join("|");
  const safeItems = useMemo(() => (Array.isArray(items) ? items.filter((it) => it && typeof it === "object") : []), [items]);
  const floorKey = floorType ?? room?.floorType;

  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  const labelEls = useRef(new Map<string, HTMLDivElement>());
  const labelAnchors = useMemo<LabelAnchor[]>(() => {
    if (!showLabels) return [];
    const out: LabelAnchor[] = [];
    safeItems.forEach((it, i) => {
      if (!it.label || !finiteNum(it.x) || !finiteNum(it.y)) return;
      const ceil = ceilingHeightAt(ra, it.x, it.y);
      const z0 = resolveBaseZ(it, safeItems, ra);
      const h = finiteNum(it.h) ? it.h : 50;
      out.push({ id: it.id ?? `#${i}`, label: it.label, pos: planToWorld({ x: it.x, y: it.y }, Math.min(z0 + h, ceil) + 6) });
    });
    return out;
  }, [showLabels, safeItems, ra]);

  return (
    <div className={className} style={className ? undefined : { width: "100%", height: "100%", minHeight: 320 }}>
      <div style={{ position: "relative", width: "100%", height: "100%" }}>
        <Canvas
          shadows={{ enabled: true, type: THREE.PCFShadowMap }}
          dpr={[1, 2]}
          camera={{ fov: CAMERA_FOV, near: 0.1, far: 400, position: [6, 5, 8] }}
          gl={{ antialias: true }}
          onCreated={({ gl }) => {
            // Neutral tone mapping keeps white walls white (ACES greys/yellows them).
            gl.toneMapping = THREE.NeutralToneMapping;
            gl.toneMappingExposure = 1.0;
          }}
          onPointerMissed={() => onSelectRef.current?.(null)}
          style={{ width: "100%", height: "100%", touchAction: "none" }}
        >
          <color attach="background" args={["#e9ebee"]} />
          <Suspense fallback={null}>
            <SceneLights ra={ra} room={room} items={safeItems} />
            <RoomShell ra={ra} room={room} wallHex={wallHex} paintHex={paint} paintedKey={paintedKey} floorType={floorKey} />
            <Furniture
              ra={ra}
              items={safeItems}
              selectedId={selectedId}
              onSelect={onSelect ? (id) => onSelectRef.current?.(id) : undefined}
            />
          </Suspense>
          <CameraRig ra={ra} preset={cameraPreset} controlled={camera} onCameraChange={onCameraChange} />
          <CaptureBridge captureRef={captureRef} />
          {showLabels && <LabelProjector anchors={labelAnchors} elements={labelEls} />}
        </Canvas>
        {showLabels && (
          <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }} aria-hidden>
            {labelAnchors.map((a) => (
              <div
                key={a.id}
                ref={(el) => {
                  if (el) labelEls.current.set(a.id, el);
                  else labelEls.current.delete(a.id);
                }}
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  visibility: "hidden",
                  whiteSpace: "nowrap",
                  fontSize: 11,
                  lineHeight: "14px",
                  padding: "1px 6px",
                  borderRadius: 6,
                  background: a.id === selectedId ? "rgba(59,130,246,0.92)" : "rgba(255,255,255,0.88)",
                  color: a.id === selectedId ? "#fff" : "#222",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
                  fontFamily: "system-ui, sans-serif",
                  willChange: "transform",
                }}
              >
                {a.label}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Labels: plain DOM overlay, positioned every frame (no extra React roots)
// ---------------------------------------------------------------------------

interface LabelAnchor {
  id: string;
  label: string;
  pos: THREE.Vector3;
}

function LabelProjector({ anchors, elements }: { anchors: LabelAnchor[]; elements: React.RefObject<Map<string, HTMLDivElement>> }) {
  const tmp = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    const map = elements.current;
    if (!map) return;
    for (const a of anchors) {
      const el = map.get(a.id);
      if (!el) continue;
      tmp.copy(a.pos).project(camera);
      const visible = tmp.z > -1 && tmp.z < 1 && Math.abs(tmp.x) < 1.2 && Math.abs(tmp.y) < 1.2;
      if (!visible) {
        el.style.visibility = "hidden";
        continue;
      }
      const x = ((tmp.x + 1) / 2) * size.width;
      const y = ((1 - tmp.y) / 2) * size.height;
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
      el.style.visibility = "visible";
      el.style.zIndex = String(Math.round((1 - tmp.z) * 10000));
    }
  });
  return null;
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

function CaptureBridge({ captureRef }: { captureRef?: Ref<RoomSceneHandle> }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useImperativeHandle(
    captureRef,
    () => ({
      capture: (opts?: { width?: number }) =>
        new Promise<Blob>((resolve, reject) => {
          try {
            // Render and read back in the same task, so preserveDrawingBuffer is not needed.
            gl.render(scene, camera);
            const src = gl.domElement;
            let out: HTMLCanvasElement = src;
            const w = opts?.width;
            if (finiteNum(w) && w > 0 && w < src.width) {
              const c = document.createElement("canvas");
              c.width = Math.round(w);
              c.height = Math.max(1, Math.round((src.height * w) / src.width));
              const ctx = c.getContext("2d");
              if (!ctx) throw new Error("2D canvas not available");
              ctx.imageSmoothingEnabled = true;
              ctx.imageSmoothingQuality = "high";
              ctx.drawImage(src, 0, 0, c.width, c.height);
              out = c;
            }
            out.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Capture failed"))), "image/jpeg", 0.85);
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        }),
    }),
    [gl, scene, camera],
  );
  return null;
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

function presetCamera(ra: RoomAnalysis, preset: "perspective" | "top", aspect: number, fovDeg: number): CameraState {
  const { minX, maxX, minY, maxY } = ra.bbox;
  const wM = Math.max((maxX - minX) / 100, 1);
  const dM = Math.max((maxY - minY) / 100, 1);
  const hM = ra.base / 100;
  const cx = ra.center.x / 100;
  const cz = -ra.center.y / 100;
  const tanV = Math.tan(((fovDeg / 2) * Math.PI) / 180);
  const a = Math.max(aspect, 0.2);
  if (preset === "top") {
    const halfD = (dM / 2) * 1.1;
    const halfW = (wM / 2) * 1.1;
    const dist = Math.max(halfD / tanV, halfW / (tanV * a)) + hM;
    return { position: [cx, dist, cz + 0.001], target: [cx, 0, cz] };
  }
  const radius = 0.5 * Math.hypot(wM, dM, hM);
  const tanMin = Math.min(tanV, tanV * a);
  const dist = (radius / Math.sin(Math.atan(tanMin))) * 0.92;
  // from the south-east, elevated ~38°
  const dir = V(0.62, 0.78, 0.9).normalize();
  const target = V(cx, Math.min(0.6, hM / 3), cz);
  const pos = target.clone().addScaledVector(dir, dist);
  return { position: [pos.x, pos.y, pos.z], target: [target.x, target.y, target.z] };
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
function camKey(c: CameraState | undefined | null): string {
  if (!c) return "";
  return [...c.position, ...c.target].map((n) => (finiteNum(n) ? r3(n).toFixed(3) : "x")).join(",");
}
function validCam(c: CameraState | undefined | null): c is CameraState {
  return (
    !!c &&
    Array.isArray(c.position) &&
    Array.isArray(c.target) &&
    [...c.position, ...c.target].length === 6 &&
    [...c.position, ...c.target].every(finiteNum)
  );
}

function CameraRig({
  ra,
  preset,
  controlled,
  onCameraChange,
}: {
  ra: RoomAnalysis;
  preset: "perspective" | "top";
  controlled?: CameraState;
  onCameraChange?: (c: CameraState) => void;
}) {
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const lastEmitted = useRef<string>("");
  const lastApplied = useRef<string>("");
  const lastPreset = useRef<string | null>(null);
  const lastRoomKey = useRef<string>("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEmitTime = useRef(0);
  const onChangeRef = useRef(onCameraChange);
  useEffect(() => {
    onChangeRef.current = onCameraChange;
  }, [onCameraChange]);

  const current = useCallback((): CameraState => {
    const t = controlsRef.current?.target ?? V(0, 0, 0);
    return {
      position: [r3(camera.position.x), r3(camera.position.y), r3(camera.position.z)],
      target: [r3(t.x), r3(t.y), r3(t.z)],
    };
  }, [camera]);

  const emitNow = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const cam = current();
    const key = camKey(cam);
    if (key === lastEmitted.current) return;
    lastEmitted.current = key;
    lastEmitTime.current = performance.now();
    onChangeRef.current?.(cam);
  }, [current]);

  const apply = useCallback(
    (c: CameraState) => {
      const controls = controlsRef.current;
      camera.position.set(...c.position);
      camera.up.copy(UP);
      if (controls) {
        controls.target.set(...c.target);
        controls.update();
      } else {
        camera.lookAt(...c.target);
      }
      lastApplied.current = camKey(c);
    },
    [camera],
  );

  const fov = presetFov(preset);
  const getState = useThree((s) => s.get);
  const syncFov = useCallback(() => {
    const cam = getState().camera as THREE.PerspectiveCamera;
    if (cam.isPerspectiveCamera && cam.fov !== fov) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }, [getState, fov]);
  const aspect = size.width / Math.max(size.height, 1);
  const roomKey = `${ra.bbox.minX},${ra.bbox.maxX},${ra.bbox.minY},${ra.bbox.maxY},${ra.base}`;

  useLayoutEffect(() => {
    const presetChanged = lastPreset.current !== null && lastPreset.current !== preset;
    const firstRun = lastPreset.current === null;
    const roomChanged = !firstRun && lastRoomKey.current !== roomKey;
    lastPreset.current = preset;
    lastRoomKey.current = roomKey;

    syncFov();
    if (firstRun) {
      if (validCam(controlled)) apply(controlled);
      else apply(presetCamera(ra, preset, aspect, fov));
      return;
    }
    if (presetChanged || (roomChanged && !validCam(controlled))) {
      apply(presetCamera(ra, preset, aspect, fov));
      emitNow();
      return;
    }
    if (validCam(controlled)) {
      const key = camKey(controlled);
      if (key !== lastEmitted.current && key !== lastApplied.current) apply(controlled);
    }
    // aspect/fov deliberately excluded: resizing must not reset the user's view
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, roomKey, controlled ? camKey(controlled) : "", apply, emitNow, syncFov]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const onChange = useCallback(() => {
    if (!onChangeRef.current) return;
    const elapsed = performance.now() - lastEmitTime.current;
    if (elapsed >= 150) {
      emitNow();
    } else if (!timer.current) {
      timer.current = setTimeout(() => {
        timer.current = null;
        emitNow();
      }, 150 - elapsed);
    }
  }, [emitNow]);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.12}
      maxPolarAngle={Math.PI / 2 - 0.03}
      minDistance={0.5}
      maxDistance={60}
      screenSpacePanning
      onChange={onChange}
    />
  );
}

// ---------------------------------------------------------------------------
// Lighting
// ---------------------------------------------------------------------------

function sunDirection(ra: RoomAnalysis, room: RoomModel): THREE.Vector3 {
  // weighted outward normal of all windows (plan coordinates)
  let ox = 0;
  let oy = 0;
  for (const f of room?.wallFeatures ?? []) {
    if (!f || f.kind !== "window") continue;
    const wall = ra.walls[f.wallIndex - 1];
    if (!wall) continue;
    const wgt = Math.max(1, (f.width || 0) * (f.height || 0));
    ox -= wall.nx * wgt;
    oy -= wall.ny * wgt;
  }
  for (const c of room?.ceilingFeatures ?? []) {
    if (!c || c.kind !== "roofWindow") continue;
    const si = slopeForPoint(ra, c.x, c.y);
    if (!si) continue;
    const wgt = Math.max(1, (c.width || 0) * (c.length || 0)) * 0.5;
    ox -= si.wall.nx * wgt;
    oy -= si.wall.ny * wgt;
  }
  const north = finiteNum(room?.northAngle) ? room.northAngle : 0;
  let compass: number;
  if (Math.hypot(ox, oy) < 1e-6)
    compass = 225; // no windows: afternoon south-west
  else compass = north + (Math.atan2(ox, oy) * 180) / Math.PI;
  compass = ((compass % 360) + 360) % 360;
  // At ~49° N with ~35° elevation the sun stays roughly between bearing 80° and 280°.
  if (compass < 80 || compass > 280) compass = compass > 180 ? 280 : 80;
  const planBearing = ((compass - north) * Math.PI) / 180;
  const elev = (35 * Math.PI) / 180;
  return V(Math.sin(planBearing) * Math.cos(elev), Math.sin(elev), -Math.cos(planBearing) * Math.cos(elev)).normalize();
}

interface LampLight {
  key: string;
  pos: THREE.Vector3;
  color: string;
  intensity: number;
}

const DEFAULT_LUMENS: Record<string, number> = { floorLamp: 800, tableLamp: 400, pendantLamp: 800, wallLight: 300, ledStrip: 300 };

function SceneLights({ ra, room, items }: { ra: RoomAnalysis; room: RoomModel; items: PlacedItem[] }) {
  const sunRef = useRef<THREE.DirectionalLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);
  const center = planToWorld(ra.center, 0);
  const dir = sunDirection(ra, room);
  const { minX, maxX, minY, maxY } = ra.bbox;
  const radius = 0.5 * Math.hypot((maxX - minX) / 100, (maxY - minY) / 100, ra.base / 100) + 0.5;
  const sunPos = center.clone().addScaledVector(dir, radius + 10);

  useLayoutEffect(() => {
    const light = sunRef.current;
    if (!light) return;
    const cam = light.shadow.camera;
    cam.left = -radius;
    cam.right = radius;
    cam.top = radius;
    cam.bottom = -radius;
    cam.near = 1;
    cam.far = radius * 2 + 20;
    cam.updateProjectionMatrix();
    light.shadow.needsUpdate = true;
  }, [radius]);

  const lamps = useMemo<LampLight[]>(() => {
    const out: LampLight[] = [];
    for (const it of items) {
      if (!LIGHT_CATEGORIES.includes(it.category)) continue;
      if (![it.x, it.y].every(finiteNum)) continue;
      const ceil = ceilingHeightAt(ra, it.x, it.y);
      const z0 = resolveBaseZ(it, items, ra);
      const h = finiteNum(it.h) ? it.h : 50;
      const r = ((finiteNum(it.rotation) ? it.rotation : 0) * Math.PI) / 180;
      const fx = Math.sin(r); // front direction in plan
      const fy = Math.cos(r);
      let hz = z0 + h * 0.8;
      let px = it.x;
      let py = it.y;
      if (it.category === "floorLamp") hz = z0 + h - 15;
      else if (it.category === "tableLamp") hz = z0 + h * 0.7;
      else if (it.category === "pendantLamp") hz = z0 + 5;
      else if (it.category === "wallLight") {
        hz = z0 + h / 2;
        px += fx * 15;
        py += fy * 15;
      } else if (it.category === "ledStrip") {
        hz = z0;
        px += fx * 10;
        py += fy * 10;
      }
      hz = Math.min(hz, ceil - 3);
      const lumens = finiteNum(it.lumens) && it.lumens > 0 ? it.lumens : (DEFAULT_LUMENS[it.category] ?? 500);
      out.push({
        key: it.id,
        pos: planToWorld({ x: px, y: py }, hz),
        color: kelvinToHex(finiteNum(it.kelvin) ? it.kelvin : 2700),
        intensity: Math.min(6, (lumens / 800) * 2.2),
      });
    }
    // keep forward-rendering cost bounded
    return out.sort((a, b) => b.intensity - a.intensity).slice(0, 8);
  }, [items, ra]);

  return (
    <>
      <hemisphereLight args={["#f4f6fb", "#d6cfc4", 2.1]} />
      <ambientLight intensity={0.6} />
      {/* soft fill without shadows (passes through the ceiling) to give furniture some form */}
      <directionalLight position={[center.x + 3, 8, center.z + 5]} intensity={0.9} color="#fff8ee" />
      <primitive object={target} position={center} />
      <directionalLight
        ref={sunRef}
        position={sunPos}
        target={target}
        intensity={2.6}
        color="#fff3e0"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-radius={4}
      />
      {lamps.map((l) => (
        <pointLight key={l.key} position={l.pos} color={l.color} intensity={l.intensity} distance={7} decay={2} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Furniture
// ---------------------------------------------------------------------------

function resolveBaseZ(item: PlacedItem, all: PlacedItem[], ra: RoomAnalysis, depth = 0): number {
  if (finiteNum(item.z)) return item.z;
  const ceil = finiteNum(item.x) && finiteNum(item.y) ? ceilingHeightAt(ra, item.x, item.y) : ra.base;
  if (item.category === "pendantLamp") {
    const h = finiteNum(item.h) ? item.h : 30;
    return Math.min(Math.max(ceil - Math.max(h, 60), 120), ceil - 15);
  }
  if (item.mount === "onTop" && item.stackedOn && depth < 4) {
    const under = all.find((o) => o.id === item.stackedOn);
    if (under && under.category !== "rug") return resolveBaseZ(under, all, ra, depth + 1) + (finiteNum(under.h) ? under.h : 0);
  }
  return itemBaseZ(item, ceil);
}

function Furniture({
  ra,
  items,
  selectedId,
  onSelect,
}: {
  ra: RoomAnalysis;
  items: PlacedItem[];
  selectedId: string | null;
  onSelect?: (id: string | null) => void;
}) {
  return (
    <>
      {items.map((it, i) => {
        if (!finiteNum(it.x) || !finiteNum(it.y)) return null;
        const ceil = ceilingHeightAt(ra, it.x, it.y);
        const z0 = resolveBaseZ(it, items, ra);
        return (
          <group key={it.id ?? i}>
            <FurnitureMesh
              item={it}
              selected={selectedId != null && it.id === selectedId}
              ceilingHeight={ceil}
              baseZ={z0}
              onClick={onSelect ? () => onSelect(it.id) : undefined}
            />
          </group>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Room shell: floor, walls, openings, slopes
// ---------------------------------------------------------------------------

function shapeFromPlan(pts: Point[], holes: Point[][] = []): THREE.Shape {
  const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x / 100, p.y / 100)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p.x / 100, p.y / 100))));
  return shape;
}

/** Disposes a memoised geometry when it is replaced or the component unmounts. */
function useDisposeOnChange(value: { dispose: () => void }) {
  useEffect(() => () => value.dispose(), [value]);
}

function RoomShell({
  ra,
  room,
  wallHex,
  paintHex,
  paintedKey,
  floorType,
}: {
  ra: RoomAnalysis;
  room: RoomModel;
  wallHex: string;
  paintHex: string | null;
  paintedKey: string;
  floorType?: string;
}) {
  const painted = useMemo(() => new Set(paintedKey ? paintedKey.split("|") : []), [paintedKey]);
  if (!ra.valid) return null;
  const surfaceColor = (key: string) => (paintHex && painted.has(key) ? paintHex : wallHex);
  const features = (room.wallFeatures ?? []).filter((f) => f && finiteNum(f.wallIndex));
  return (
    <group>
      <Floor ra={ra} floorType={floorType} />
      <WallFootprint ra={ra} />
      {ra.walls.map((w) =>
        w.length >= 1 ? (
          <Wall
            key={w.index}
            ra={ra}
            wall={w}
            color={surfaceColor(`W${w.index}`)}
            features={features.filter((f) => f.wallIndex === w.index)}
          />
        ) : null,
      )}
      <Ceiling ra={ra} room={room} slopeColor={(id) => surfaceColor(`slope:${id}`)} />
    </group>
  );
}

function Floor({ ra, floorType }: { ra: RoomAnalysis; floorType?: string }) {
  const geo = useMemo(() => {
    const g = new THREE.ShapeGeometry(shapeFromPlan(ra.corners));
    g.rotateX(-Math.PI / 2); // (x, y, 0) → (x, 0, −y)
    return g;
  }, [ra]);
  useDisposeOnChange(geo);
  const tex = useMemo(() => getFloorTexture(floorType), [floorType]);
  return (
    <mesh geometry={geo} receiveShadow>
      <meshStandardMaterial map={tex.texture} roughness={tex.roughness} metalness={0} />
    </mesh>
  );
}

function WallFootprint({ ra }: { ra: RoomAnalysis }) {
  const geo = useMemo(() => {
    const outer = offsetPolygon(ra, 14);
    const g = new THREE.ShapeGeometry(shapeFromPlan(outer, [ra.corners]));
    g.rotateX(-Math.PI / 2);
    return g;
  }, [ra]);
  useDisposeOnChange(geo);
  const lines = useMemo(() => {
    // top outline of every wall + vertical corner edges (visible even where walls are culled)
    const segs: THREE.Vector3[][] = [];
    for (const w of ra.walls) {
      if (w.length < 1) continue;
      const prof = wallTopProfile(ra, w);
      segs.push(prof.map((p) => planToWorld({ x: w.a.x + w.ux * p.s, y: w.a.y + w.uy * p.s }, p.h)));
      segs.push([planToWorld(w.a, 0), planToWorld(w.a, prof[0].h)]);
    }
    return segs;
  }, [ra]);
  return (
    <>
      <mesh geometry={geo} position={[0, 0.002, 0]} receiveShadow>
        <meshStandardMaterial color="#5b5f66" roughness={0.9} />
      </mesh>
      {lines.map((pts, i) => (
        <Line key={i} points={pts} color="#6b7078" lineWidth={1.2} transparent opacity={0.7} />
      ))}
    </>
  );
}

interface Opening {
  f: WallFeature;
  s0: number;
  s1: number;
  t0: number;
  t1: number;
}

function wallOpenings(ra: RoomAnalysis, wall: WallInfo, feats: WallFeature[], profile: { s: number; h: number }[]): Opening[] {
  const out: Opening[] = [];
  const cand = feats
    .filter((f) => (f.kind === "door" || f.kind === "window") && [f.offset, f.width, f.height].every(finiteNum))
    .sort((a, b) => a.offset - b.offset);
  for (const f of cand) {
    const s0 = Math.max(f.offset, 2);
    const s1 = Math.min(f.offset + f.width, wall.length - 2);
    if (s1 - s0 < 5) continue;
    const top = profileMinBetween(profile, s0, s1) - 3;
    const t0 = Math.max(finiteNum(f.z) ? f.z : 0, 0);
    const t1 = Math.min(t0 + f.height, top);
    if (t1 - t0 < 5) continue;
    const overlaps = out.some((o) => s0 < o.s1 + 2 && s1 > o.s0 - 2 && t0 < o.t1 + 2 && t1 > o.t0 - 2);
    if (overlaps) continue;
    out.push({ f, s0, s1, t0: t0 < 1 ? 0 : t0, t1 });
  }
  return out;
}

function Wall({ ra, wall, color, features }: { ra: RoomAnalysis; wall: WallInfo; color: string; features: WallFeature[] }) {
  const profile = useMemo(() => wallTopProfile(ra, wall), [ra, wall]);
  const openings = useMemo(() => wallOpenings(ra, wall, features, profile), [ra, wall, features, profile]);
  const inward = ra.clockwise ? 1 : -1;

  const geo = useMemo(() => {
    const pts: THREE.Vector2[] = [new THREE.Vector2(0, 0)];
    const holes: THREE.Path[] = [];
    for (const o of openings) {
      if (o.t0 === 0) {
        pts.push(new THREE.Vector2(o.s0 / 100, 0), new THREE.Vector2(o.s0 / 100, o.t1 / 100));
        pts.push(new THREE.Vector2(o.s1 / 100, o.t1 / 100), new THREE.Vector2(o.s1 / 100, 0));
      } else {
        holes.push(
          new THREE.Path([
            new THREE.Vector2(o.s0 / 100, o.t0 / 100),
            new THREE.Vector2(o.s1 / 100, o.t0 / 100),
            new THREE.Vector2(o.s1 / 100, o.t1 / 100),
            new THREE.Vector2(o.s0 / 100, o.t1 / 100),
          ]),
        );
      }
    }
    pts.push(new THREE.Vector2(wall.length / 100, 0));
    for (let i = profile.length - 1; i >= 0; i--) pts.push(new THREE.Vector2(profile[i].s / 100, profile[i].h / 100));
    const shape = new THREE.Shape(pts);
    shape.holes = holes;
    return new THREE.ShapeGeometry(shape);
  }, [profile, openings, wall]);
  useDisposeOnChange(geo);

  const { position, quaternion } = useMemo(() => {
    const X = V(wall.ux, 0, -wall.uy);
    const Z = new THREE.Vector3().crossVectors(X, UP);
    const m = new THREE.Matrix4().makeBasis(X, UP, Z);
    return { position: planToWorld(wall.a, 0), quaternion: new THREE.Quaternion().setFromRotationMatrix(m) };
  }, [wall]);

  const others = features.filter((f) => f.kind !== "door" && f.kind !== "window");

  const trimRef = useRef<THREE.Group>(null);
  useFrame(({ camera }) => {
    const g = trimRef.current;
    if (!g) return;
    // inward normal in world: plan (nx, ny) → (nx, 0, −ny); wall start at (ax, 0, −ay)
    const side = (camera.position.x - wall.a.x / 100) * wall.nx + (camera.position.z + wall.a.y / 100) * -wall.ny;
    const visible = side > -0.05;
    if (g.visible !== visible) g.visible = visible;
  });

  return (
    <group position={position} quaternion={quaternion}>
      <mesh geometry={geo} castShadow receiveShadow>
        <meshStandardMaterial color={color} roughness={0.92} side={inward > 0 ? THREE.FrontSide : THREE.BackSide} />
      </mesh>
      {/* trim (reveals, frames, panes, sills) is hidden while the camera is outside this wall */}
      <group ref={trimRef}>
        {openings.map((o) => (
          <OpeningParts key={o.f.id} o={o} inward={inward} wallColor={color} part="trim" />
        ))}
      </group>
      {openings.map((o) => (
        <OpeningParts key={o.f.id} o={o} inward={inward} wallColor={color} part="leaf" />
      ))}
      {others.map((f) => (
        <WallFixture key={f.id} f={f} inward={inward} wallColor={color} wallLength={wall.length} />
      ))}
    </group>
  );
}

function OpeningParts({ o, inward, wallColor, part }: { o: Opening; inward: number; wallColor: string; part: "trim" | "leaf" }) {
  const s0 = o.s0 / 100;
  const s1 = o.s1 / 100;
  const t0 = o.t0 / 100;
  const t1 = o.t1 / 100;
  const w = s1 - s0;
  const h = t1 - t0;
  const cx = (s0 + s1) / 2;
  const cy = (t0 + t1) / 2;
  const revealZ = (-inward * WALL_THICKNESS) / 2;
  const revealColor = mixHex(wallColor, "#000000", 0.06);
  const frame = "#f3f2ee";
  const ft = 0.05;
  const reveals: ReactNode = (
    <>
      <mesh position={[s0, cy, revealZ]} rotation={[0, (inward * Math.PI) / 2, 0]} castShadow receiveShadow>
        <planeGeometry args={[WALL_THICKNESS, h]} />
        <meshStandardMaterial color={revealColor} roughness={0.92} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[s1, cy, revealZ]} rotation={[0, (-inward * Math.PI) / 2, 0]} castShadow receiveShadow>
        <planeGeometry args={[WALL_THICKNESS, h]} />
        <meshStandardMaterial color={revealColor} roughness={0.92} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[cx, t1, revealZ]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <planeGeometry args={[w, WALL_THICKNESS]} />
        <meshStandardMaterial color={revealColor} roughness={0.92} side={THREE.DoubleSide} />
      </mesh>
      {t0 > 0 && (
        <mesh position={[cx, t0, revealZ]} rotation={[-Math.PI / 2, 0, 0]} castShadow receiveShadow>
          <planeGeometry args={[w, WALL_THICKNESS]} />
          <meshStandardMaterial color={revealColor} roughness={0.92} side={THREE.DoubleSide} />
        </mesh>
      )}
    </>
  );

  if (o.f.kind === "window") {
    if (part === "leaf") return null;
    const paneZ = -inward * WALL_THICKNESS * 0.45;
    const mullion = w > 0.9;
    return (
      <group>
        {reveals}
        <group position={[0, 0, paneZ]}>
          <mesh position={[cx, t0 + ft / 2, 0]} castShadow>
            <boxGeometry args={[w, ft, 0.07]} />
            <meshStandardMaterial color={frame} roughness={0.5} />
          </mesh>
          <mesh position={[cx, t1 - ft / 2, 0]} castShadow>
            <boxGeometry args={[w, ft, 0.07]} />
            <meshStandardMaterial color={frame} roughness={0.5} />
          </mesh>
          <mesh position={[s0 + ft / 2, cy, 0]} castShadow>
            <boxGeometry args={[ft, h, 0.07]} />
            <meshStandardMaterial color={frame} roughness={0.5} />
          </mesh>
          <mesh position={[s1 - ft / 2, cy, 0]} castShadow>
            <boxGeometry args={[ft, h, 0.07]} />
            <meshStandardMaterial color={frame} roughness={0.5} />
          </mesh>
          {mullion && (
            <mesh position={[cx, cy, 0]} castShadow>
              <boxGeometry args={[ft * 1.2, h, 0.07]} />
              <meshStandardMaterial color={frame} roughness={0.5} />
            </mesh>
          )}
          <mesh position={[cx, cy, 0]}>
            <planeGeometry args={[w - ft, h - ft]} />
            <meshStandardMaterial
              color="#bfe2f5"
              transparent
              opacity={0.28}
              roughness={0.05}
              metalness={0.1}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
        </group>
        {t0 > 0.05 && (
          <mesh position={[cx, t0 - 0.015, inward * 0.06]} castShadow receiveShadow>
            <boxGeometry args={[w + 0.06, 0.03, 0.16]} />
            <meshStandardMaterial color="#f1f0ec" roughness={0.6} />
          </mesh>
        )}
      </group>
    );
  }

  // door
  const opensIn = o.f.opens !== "outward";
  const hingeAtStart = o.f.hinge !== "end";
  const dirSign = hingeAtStart ? 1 : -1;
  const leafW = Math.max(w - 0.02, 0.1);
  const leafH = Math.max(h - 0.01, 0.1);
  const angle = opensIn ? (30 * Math.PI) / 180 : 0;
  const phi = -dirSign * inward * angle;
  const pivotS = hingeAtStart ? s0 + 0.01 : s1 - 0.01;
  const pivotZ = opensIn ? 0 : -inward * WALL_THICKNESS * 0.8;
  if (part === "leaf") {
    return (
      <>
        {/* invisible, shadow-only plane: no sunlight through the door opening (the hall is indoors) */}
        <mesh position={[cx, cy, -inward * WALL_THICKNESS]} castShadow raycast={() => null}>
          <planeGeometry args={[w, h]} />
          <meshBasicMaterial colorWrite={false} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
        <group position={[pivotS, t0, pivotZ]} rotation={[0, phi, 0]}>
          <mesh position={[(dirSign * leafW) / 2, leafH / 2, inward * 0.02]} castShadow receiveShadow>
            <boxGeometry args={[leafW, leafH, 0.04]} />
            <meshStandardMaterial color="#f4f2ed" roughness={0.55} />
          </mesh>
          {[1, -1].map((side) => (
            <mesh key={side} position={[dirSign * (leafW - 0.07), 1.05 - t0, inward * 0.02 + side * 0.035]} castShadow>
              <boxGeometry args={[0.12, 0.02, 0.02]} />
              <meshStandardMaterial color="#9a9a9a" metalness={0.7} roughness={0.3} />
            </mesh>
          ))}
        </group>
      </>
    );
  }
  return (
    <group>
      {reveals}
      {/* frame (architrave) on the room side */}
      <mesh position={[s0 - 0.03, t0 + h / 2, inward * 0.01]} castShadow>
        <boxGeometry args={[0.06, h + 0.03, 0.02]} />
        <meshStandardMaterial color={frame} roughness={0.5} />
      </mesh>
      <mesh position={[s1 + 0.03, t0 + h / 2, inward * 0.01]} castShadow>
        <boxGeometry args={[0.06, h + 0.03, 0.02]} />
        <meshStandardMaterial color={frame} roughness={0.5} />
      </mesh>
      <mesh position={[cx, t1 + 0.03, inward * 0.01]} castShadow>
        <boxGeometry args={[w + 0.12, 0.06, 0.02]} />
        <meshStandardMaterial color={frame} roughness={0.5} />
      </mesh>
    </group>
  );
}

function WallFixture({ f, inward, wallColor, wallLength }: { f: WallFeature; inward: number; wallColor: string; wallLength: number }) {
  if (![f.offset, f.width].every(finiteNum)) return null;
  const s0 = Math.max(0, f.offset) / 100;
  const w = Math.max(1, Math.min(f.width, wallLength - Math.max(0, f.offset))) / 100;
  if (w <= 0) return null;
  const h = Math.max(finiteNum(f.height) ? f.height : 10, 1) / 100;
  const z = Math.max(finiteNum(f.z) ? f.z : 0, 0) / 100;
  const cx = s0 + w / 2;

  if (f.kind === "radiator") {
    const depth = 0.1;
    const zc = inward * (0.05 + depth / 2);
    const n = Math.max(2, Math.floor(w / 0.05));
    const step = w / n;
    return (
      <group>
        <mesh position={[cx, z + h / 2, zc]} castShadow receiveShadow>
          <boxGeometry args={[w, h * 0.92, depth * 0.6]} />
          <meshStandardMaterial color="#f2f2f0" roughness={0.45} />
        </mesh>
        {Array.from({ length: n }, (_, i) => (
          <mesh key={i} position={[s0 + step * (i + 0.5), z + h / 2, zc]} castShadow receiveShadow>
            <boxGeometry args={[step * 0.55, h, depth]} />
            <meshStandardMaterial color="#f6f6f4" roughness={0.45} />
          </mesh>
        ))}
        <mesh position={[s0 + 0.04, z + h - 0.03, zc]}>
          <boxGeometry args={[0.04, 0.06, depth + 0.03]} />
          <meshStandardMaterial color="#e0e0dc" roughness={0.4} />
        </mesh>
      </group>
    );
  }
  if (f.kind === "builtIn") {
    const depth = Math.max(finiteNum(f.depth) ? f.depth : 30, 2) / 100;
    return (
      <mesh position={[cx, z + h / 2, (inward * depth) / 2]} castShadow receiveShadow>
        <boxGeometry args={[w, h, depth]} />
        <meshStandardMaterial color={mixHex(wallColor, "#8a8a8a", 0.15)} roughness={0.85} />
      </mesh>
    );
  }
  // socket / switch / connection: tiny plates
  const pw = Math.min(w, 0.3);
  const ph = Math.min(h, 0.3);
  return (
    <mesh position={[cx, z + ph / 2, inward * 0.006]}>
      <boxGeometry args={[pw, ph, 0.012]} />
      <meshStandardMaterial color={f.kind === "connection" ? "#e4e4e0" : "#fbfbf9"} roughness={0.4} />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// Ceiling: sloped surfaces, roof windows, lights, shadow-only flat ceiling
// ---------------------------------------------------------------------------

function slopeForPoint(ra: RoomAnalysis, x: number, y: number): SlopeInfo | null {
  let best: SlopeInfo | null = null;
  let bestH = Infinity;
  for (const si of ra.slopes) {
    const d = slopeDistance(si, x, y);
    if (d < -30 || d > si.full + 30) continue;
    const h = si.knee + ((si.base - si.knee) * Math.max(0, Math.min(d, si.full))) / si.full;
    if (h < bestH) {
      bestH = h;
      best = si;
    }
  }
  return best;
}

interface RoofWindowPlacement {
  f: CeilingFeature;
  si: SlopeInfo | null;
  /** plan-space corners of the window opening (cm) */
  planRect: Point[];
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  w: number; // m
  l: number; // m
}

function slopeFrame(si: SlopeInfo) {
  const U = V(si.wall.ux, 0, -si.wall.uy);
  const N = V(si.wall.nx, 0, -si.wall.ny);
  const rise = (si.base - si.knee) / 100;
  const run = si.full / 100;
  const Vs = N.clone().multiplyScalar(run).addScaledVector(UP, rise).normalize();
  let X = U.clone();
  let Z = new THREE.Vector3().crossVectors(X, Vs);
  if (Z.y > 0) {
    X = U.clone().negate();
    Z.negate();
  }
  Z = Z.normalize();
  const cosA = run / Math.hypot(run, rise);
  return { U, N, Vs, X, Z, cosA, rise, run };
}

function placeRoofWindow(ra: RoomAnalysis, f: CeilingFeature): RoofWindowPlacement | null {
  if (!finiteNum(f.x) || !finiteNum(f.y)) return null;
  const wCm = finiteNum(f.width) && f.width > 5 ? f.width : 78;
  const lCm = finiteNum(f.length) && f.length > 5 ? f.length : 118;
  const si = slopeForPoint(ra, f.x, f.y);
  if (!si) {
    // flat skylight at the ceiling
    const h = ceilingHeightAt(ra, f.x, f.y) - 0.5;
    const planRect = [
      { x: f.x - wCm / 2, y: f.y - lCm / 2 },
      { x: f.x + wCm / 2, y: f.y - lCm / 2 },
      { x: f.x + wCm / 2, y: f.y + lCm / 2 },
      { x: f.x - wCm / 2, y: f.y + lCm / 2 },
    ];
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
    return { f, si: null, planRect, position: planToWorld({ x: f.x, y: f.y }, h), quaternion: q, w: wCm / 100, l: lCm / 100 };
  }
  const fr = slopeFrame(si);
  const slopeLen = si.full / fr.cosA; // cm along the slope
  const a = (f.x - si.wall.a.x) * si.wall.ux + (f.y - si.wall.a.y) * si.wall.uy; // along the wall
  // Lower edge from lowerEdgeZ when given (most reliable), otherwise centred on (x, y).
  let rLow: number;
  if (finiteNum(f.lowerEdgeZ)) {
    const dLow = ((f.lowerEdgeZ - si.knee) / (si.base - si.knee)) * si.full;
    rLow = dLow / fr.cosA;
  } else {
    rLow = Math.max(0, slopeDistance(si, f.x, f.y)) / fr.cosA - lCm / 2;
  }
  const len = Math.min(lCm, slopeLen - 4);
  if (len < 10) return null;
  rLow = Math.max(2, Math.min(rLow, slopeLen - 2 - len));
  const rC = rLow + len / 2;
  const dC = rC * fr.cosA;
  const centerPlan = { x: si.wall.a.x + si.wall.ux * a + si.wall.nx * dC, y: si.wall.a.y + si.wall.uy * a + si.wall.ny * dC };
  const hC = si.knee + ((si.base - si.knee) * dC) / si.full;
  const position = planToWorld(centerPlan, hC).addScaledVector(fr.Z, 0.004);
  const m = new THREE.Matrix4().makeBasis(fr.X, fr.Vs, fr.Z);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(m);
  const planRect: Point[] = [];
  for (const [sa, sr] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    const aa = a + (sa * wCm) / 2;
    const dd = (rC + (sr * len) / 2) * fr.cosA;
    planRect.push({ x: si.wall.a.x + si.wall.ux * aa + si.wall.nx * dd, y: si.wall.a.y + si.wall.uy * aa + si.wall.ny * dd });
  }
  return { f, si, planRect, position, quaternion, w: wCm / 100, l: len / 100 };
}

/** Triangulated plan polygon lifted to a height function; triangles oriented to face down. */
function liftedGeometry(region: Point[], holes: Point[][], heightCm: (p: Point) => number): THREE.BufferGeometry {
  const contour = region.map((p) => new THREE.Vector2(p.x, p.y));
  const holeVecs = holes.map((h) => h.map((p) => new THREE.Vector2(p.x, p.y)));
  const tris = THREE.ShapeUtils.triangulateShape(contour, holeVecs);
  const all = [...region, ...holes.flat()];
  const positions: number[] = [];
  for (const p of all) {
    const w = planToWorld(p, heightCm(p));
    positions.push(w.x, w.y, w.z);
  }
  const index: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (const [i, j, k] of tris) {
    a.fromArray(positions, i * 3);
    b.fromArray(positions, j * 3);
    c.fromArray(positions, k * 3);
    const n = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
    if (n.y > 0) index.push(i, k, j);
    else index.push(i, j, k);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

function Ceiling({ ra, room, slopeColor }: { ra: RoomAnalysis; room: RoomModel; slopeColor: (id: string) => string }) {
  const roofWindows = useMemo(
    () =>
      (room.ceilingFeatures ?? [])
        .filter((f) => f && f.kind === "roofWindow")
        .map((f) => placeRoofWindow(ra, f))
        .filter((p): p is RoofWindowPlacement => p !== null),
    [ra, room.ceilingFeatures],
  );
  const lightsFx = (room.ceilingFeatures ?? []).filter((f) => f && f.kind === "ceilingLight" && finiteNum(f.x) && finiteNum(f.y));

  const slopeMeshes = useMemo(() => {
    return ra.slopes.map((si) => {
      const region = slopeRegion(ra, si);
      if (region.length < 3) return null;
      const holes = roofWindows
        .filter((rw) => rw.si === si && rw.planRect.every((p) => pointInPolygon(p, region)))
        .map((rw) => rw.planRect);
      const geo = liftedGeometry(region, holes, (p) => si.knee + ((si.base - si.knee) * slopeDistance(si, p.x, p.y)) / si.full);
      return { si, geo };
    });
  }, [ra, roofWindows]);
  useEffect(() => () => slopeMeshes.forEach((m) => m?.geo.dispose()), [slopeMeshes]);

  const flatGeo = useMemo(() => {
    const region = flatCeilingRegion(ra);
    if (region.length < 3) return new THREE.BufferGeometry();
    const holes = roofWindows
      .filter((rw) => rw.si === null && rw.planRect.every((p) => pointInPolygon(p, region)))
      .map((rw) => rw.planRect);
    return liftedGeometry(region, holes, () => ra.base + 0.5);
  }, [ra, roofWindows]);
  useDisposeOnChange(flatGeo);

  return (
    <>
      {slopeMeshes.map((m) =>
        m ? (
          <group key={m.si.slope.id}>
            <mesh geometry={m.geo} castShadow receiveShadow>
              <meshStandardMaterial color={slopeColor(m.si.slope.id)} roughness={0.92} side={THREE.FrontSide} />
            </mesh>
            {/* faint "ghost" when seen from above, so the slope stays readable in top views */}
            <mesh geometry={m.geo} raycast={() => null}>
              <meshBasicMaterial
                color={mixHex(slopeColor(m.si.slope.id), "#8899aa", 0.4)}
                side={THREE.BackSide}
                transparent
                opacity={0.22}
                depthWrite={false}
              />
            </mesh>
          </group>
        ) : null,
      )}
      {/* invisible, shadow-only flat ceiling */}
      <mesh geometry={flatGeo} castShadow raycast={() => null}>
        <meshBasicMaterial colorWrite={false} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      {roofWindows.map((rw) => (
        <RoofWindow key={rw.f.id} rw={rw} />
      ))}
      {lightsFx.map((f) => {
        const h = ceilingHeightAt(ra, f.x, f.y);
        return (
          <mesh key={f.id} position={planToWorld({ x: f.x, y: f.y }, h - 1.5)}>
            <cylinderGeometry args={[0.07, 0.07, 0.03, 20]} />
            <meshStandardMaterial color="#fbfaf6" emissive="#fff4e0" emissiveIntensity={0.25} roughness={0.4} />
          </mesh>
        );
      })}
    </>
  );
}

function RoofWindow({ rw }: { rw: RoofWindowPlacement }) {
  const { w, l } = rw;
  const ft = 0.06;
  const frame = "#f3f2ee";
  const ref = useRef<THREE.Group>(null);
  const normal = useMemo(() => V(0, 0, 1).applyQuaternion(rw.quaternion), [rw.quaternion]);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  // hide when the camera looks at the slope from outside (above), like the culled slope itself
  useFrame(({ camera }) => {
    const g = ref.current;
    if (!g) return;
    const visible = tmp.copy(camera.position).sub(rw.position).dot(normal) > -0.05;
    if (g.visible !== visible) g.visible = visible;
  });
  return (
    <group ref={ref} position={rw.position} quaternion={rw.quaternion}>
      {[
        { p: [0, -l / 2 + ft / 2, 0], s: [w, ft, 0.05] },
        { p: [0, l / 2 - ft / 2, 0], s: [w, ft, 0.05] },
        { p: [-w / 2 + ft / 2, 0, 0], s: [ft, l, 0.05] },
        { p: [w / 2 - ft / 2, 0, 0], s: [ft, l, 0.05] },
      ].map((b, i) => (
        <mesh key={i} position={b.p as [number, number, number]} castShadow>
          <boxGeometry args={b.s as [number, number, number]} />
          <meshStandardMaterial color={frame} roughness={0.5} />
        </mesh>
      ))}
      <mesh position={[0, 0, -0.02]}>
        <planeGeometry args={[w - ft, l - ft]} />
        <meshStandardMaterial
          color="#bfe2f5"
          transparent
          opacity={0.3}
          roughness={0.05}
          metalness={0.1}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <mesh position={[0, -l / 2 + ft + 0.03, 0.025]}>
        <boxGeometry args={[w * 0.5, 0.03, 0.03]} />
        <meshStandardMaterial color="#9a9a9a" metalness={0.6} roughness={0.3} />
      </mesh>
    </group>
  );
}
