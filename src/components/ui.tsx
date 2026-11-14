"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { parseLength } from "@/lib/units";
import type { EstimateInfo } from "@/lib/types";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
export function Button({
  children,
  variant = "secondary",
  size = "md",
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: "sm" | "md" }) {
  const v: Record<BtnVariant, string> = {
    primary: "bg-stone-900 text-white hover:bg-stone-700 disabled:bg-stone-400",
    secondary: "bg-white text-stone-800 ring-1 ring-stone-300 hover:bg-stone-50 disabled:text-stone-400",
    ghost: "text-stone-700 hover:bg-stone-100 disabled:text-stone-400",
    danger: "bg-white text-red-700 ring-1 ring-red-200 hover:bg-red-50 disabled:opacity-50",
    subtle: "bg-stone-100 text-stone-800 hover:bg-stone-200 disabled:text-stone-400",
  };
  return (
    <button
      {...rest}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition disabled:cursor-not-allowed",
        size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm",
        v[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function LinkButton({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={cx("inline-flex items-center gap-1.5 rounded-md bg-white px-3.5 py-2 text-sm font-medium text-stone-800 ring-1 ring-stone-300 hover:bg-stone-50", className)}>
      {children}
    </Link>
  );
}

export function Card({ children, className, title, actions }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={cx("rounded-xl bg-white p-5 shadow-sm ring-1 ring-stone-200", className)}>
      {(title || actions) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-base font-semibold text-stone-900">{title}</h2>}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Badge({ children, tone = "stone", title }: { children: ReactNode; tone?: "stone" | "green" | "amber" | "red" | "blue" | "violet"; title?: string }) {
  const t = {
    stone: "bg-stone-100 text-stone-700",
    green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    amber: "bg-amber-50 text-amber-800 ring-amber-200",
    red: "bg-red-50 text-red-700 ring-red-200",
    blue: "bg-sky-50 text-sky-700 ring-sky-200",
    violet: "bg-violet-50 text-violet-700 ring-violet-200",
  }[tone];
  return (
    <span title={title} className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ring-transparent", t)}>
      {children}
    </span>
  );
}

export function Field({ label, children, hint, className }: { label: ReactNode; children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <label className={cx("block text-sm", className)}>
      <span className="mb-1 block font-medium text-stone-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-stone-500">{hint}</span>}
    </label>
  );
}

export const inputCls = "w-full rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm text-stone-900 outline-none focus:border-stone-500 disabled:bg-stone-50";

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputCls, props.className)} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(inputCls, "min-h-[90px]", props.className)} />;
}

export function Select<T extends string>({ value, onChange, options, className, disabled }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; className?: string; disabled?: boolean }) {
  return (
    <select disabled={disabled} value={value} onChange={(e) => onChange(e.target.value as T)} className={cx(inputCls, className)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Estimate marker shown next to a value whose source is "estimated". */
export function EstimateTag({ info }: { info?: EstimateInfo }) {
  if (!info || info.source === "user") return null;
  if (info.source === "default") return <Badge tone="stone" title="Template default — please check">default</Badge>;
  return (
    <Badge tone="amber" title={info.reason}>
      estimated · {info.confidence ?? "low"}
    </Badge>
  );
}

/**
 * Length input in cm. Accepts "86", "86,5", "4,20 m" (→ 420). Validates plausibility on blur.
 */
export function CmInput({
  value,
  onChange,
  min = 0,
  max = 2000,
  estimate,
  disabled,
  className,
  ariaLabel,
  allowNegative,
}: {
  value: number | undefined | null;
  onChange: (cm: number) => void;
  min?: number;
  max?: number;
  estimate?: EstimateInfo;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  allowNegative?: boolean;
}) {
  const [text, setText] = useState(value == null ? "" : String(value));
  const [error, setError] = useState<string | null>(null);
  const [prevValue, setPrevValue] = useState(value);
  const id = useId();
  // Sync the text when the value changes from outside (derived during render, not in an effect).
  if (value !== prevValue) {
    setPrevValue(value);
    setText(value == null ? "" : String(value));
  }
  function commit() {
    const t = text.trim();
    if (t === "" && value == null) return;
    const isM = /m\s*$/i.test(t) && !/cm\s*$/i.test(t);
    const cleaned = t.replace(/c?m\s*$/i, "").trim();
    const neg = allowNegative && cleaned.startsWith("-");
    const r = parseLength(neg ? cleaned.slice(1) : cleaned, isM ? "m" : "cm", { min: allowNegative ? 0 : min, max });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setError(null);
    const v = neg ? -r.value : r.value;
    if (v !== value) onChange(v);
    setText(String(v));
  }
  const est = estimate && estimate.source === "estimated";
  return (
    <span className={cx("inline-flex flex-col", className)}>
      <span className="relative inline-flex items-center">
        <input
          id={id}
          aria-label={ariaLabel}
          disabled={disabled}
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className={cx(inputCls, "w-24 pr-8 tabular-nums", est && "border-amber-400 bg-amber-50", error && "border-red-400")}
          title={est ? `Estimated (${estimate?.confidence}): ${estimate?.reason ?? ""}` : undefined}
        />
        <span className="pointer-events-none absolute right-2 text-xs text-stone-400">cm</span>
      </span>
      {error && <span className="mt-0.5 text-xs text-red-600">{error}</span>}
    </span>
  );
}

export function NumInput({ value, onChange, className, step, ariaLabel }: { value: number; onChange: (v: number) => void; className?: string; step?: number; ariaLabel?: string }) {
  const [text, setText] = useState(String(value));
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setText(String(value));
  }
  return (
    <input
      aria-label={ariaLabel}
      inputMode="decimal"
      step={step}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const n = Number(text.replace(",", "."));
        if (Number.isFinite(n)) onChange(n);
        else setText(String(value));
      }}
      className={cx(inputCls, "w-20 tabular-nums", className)}
    />
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: ReactNode; disabled?: boolean }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-stone-200">
      {tabs.map((t) => (
        <button
          key={t.value}
          disabled={t.disabled}
          onClick={() => onChange(t.value)}
          className={cx(
            "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:text-stone-300",
            value === t.value ? "border-stone-900 text-stone-900" : "border-transparent text-stone-500 hover:text-stone-800",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-stone-900/40 p-6" onMouseDown={onClose}>
      <div className={cx("mt-10 w-full rounded-xl bg-white p-6 shadow-xl", wide ? "max-w-5xl" : "max-w-lg")} onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-stone-900">{title}</h3>
          <button onClick={onClose} className="rounded p-1 text-stone-500 hover:bg-stone-100" aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx("inline-block h-4 w-4 animate-spin rounded-full border-2 border-stone-300 border-t-stone-800", className)} />;
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "error" | "ok"; children: ReactNode }) {
  const t = {
    info: "bg-sky-50 text-sky-900 ring-sky-200",
    warn: "bg-amber-50 text-amber-900 ring-amber-200",
    error: "bg-red-50 text-red-800 ring-red-200",
    ok: "bg-emerald-50 text-emerald-900 ring-emerald-200",
  }[tone];
  return <div className={cx("rounded-lg px-3.5 py-2.5 text-sm ring-1", t)}>{children}</div>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-stone-300 p-8 text-center">
      <p className="font-medium text-stone-700">{title}</p>
      {children && <div className="mt-2 text-sm text-stone-500">{children}</div>}
    </div>
  );
}

export function Swatch({ hex, size = 16, title }: { hex: string; size?: number; title?: string }) {
  return <span title={title ?? hex} className="inline-block rounded ring-1 ring-black/10" style={{ width: size, height: size, background: hex }} />;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Object URL for a Blob, revoked on change/unmount. */
export function useObjectUrl(blob: Blob | null | undefined): string | null {
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);
  return url;
}

/** Safe external link: only http(s), rel noopener noreferrer nofollow, domain shown. */
export function ExternalLink({ href, children }: { href: string; children?: ReactNode }) {
  let ok = false;
  let host = "";
  try {
    const u = new URL(href);
    ok = u.protocol === "https:" || u.protocol === "http:";
    host = u.hostname.replace(/^www\./, "");
  } catch {
    ok = false;
  }
  if (!ok) return <span className="text-stone-400">invalid link</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900">
      {children ?? host} <span className="text-xs text-stone-400">({host})</span>
    </a>
  );
}
