"use client";

import Link from "next/link";
import type { ReactNode } from "react";

export function Shell({ crumbs, children, actions }: { crumbs?: { label: string; href?: string }[]; children: ReactNode; actions?: ReactNode }) {
  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }
  return (
    <div className="min-h-screen bg-stone-100 text-stone-900">
      <header className="sticky top-0 z-30 border-b border-stone-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-6 py-3">
          <Link href="/" className="font-semibold tracking-tight text-stone-900">
            ◰ Room Planner
          </Link>
          {crumbs?.map((c, i) => (
            <span key={i} className="flex items-center gap-3 text-sm text-stone-500">
              <span>/</span>
              {c.href ? (
                <Link href={c.href} className="hover:text-stone-900">
                  {c.label}
                </Link>
              ) : (
                <span className="text-stone-800">{c.label}</span>
              )}
            </span>
          ))}
          <div className="ml-auto flex items-center gap-2">
            {actions}
            <button onClick={logout} className="rounded px-2 py-1 text-xs text-stone-500 hover:bg-stone-100 hover:text-stone-800">
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] px-6 py-6">{children}</main>
    </div>
  );
}
