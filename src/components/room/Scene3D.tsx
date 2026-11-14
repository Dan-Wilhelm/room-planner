"use client";

import dynamic from "next/dynamic";

// three.js must only run in the browser.
export const Scene3D = dynamic(() => import("@/components/three/RoomScene"), {
  ssr: false,
  loading: () => <div className="flex h-full min-h-[360px] items-center justify-center rounded-lg bg-stone-200 text-sm text-stone-500">Loading 3D…</div>,
});
