"use client";
import { formatUnits } from "viem";
import { addrUrl, txUrl } from "@/lib/config";
import type { ReactNode } from "react";

export function Card({ title, children, right, className = "" }: { title?: ReactNode; children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-border bg-surface p-5 ${className}`}>
      {(title || right) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="num mt-1 truncate text-lg font-semibold">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

type Tone = "neutral" | "ok" | "warn" | "bad" | "accent" | "sim";
const tones: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted border-border",
  ok: "bg-ok-soft text-ok border-ok/30",
  warn: "bg-warn-soft text-warn border-warn/30",
  bad: "bg-bad-soft text-bad border-bad/30",
  accent: "bg-accent-soft text-accent-strong border-accent/30",
  sim: "bg-sim-soft text-sim border-sim/40",
};
export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function Notice({ tone = "neutral", title, children }: { tone?: Tone; title?: ReactNode; children?: ReactNode }) {
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={`rounded-lg border px-4 py-3 text-sm ${tones[tone]}`}>
      {title && <div className="font-semibold">{title}</div>}
      {children && <div className={title ? "mt-1" : ""}>{children}</div>}
    </div>
  );
}

export function Button({ children, variant = "primary", className = "", ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  const v = {
    primary: "bg-accent text-white hover:bg-accent-strong dark:text-black",
    secondary: "border border-border bg-surface hover:bg-surface-2",
    danger: "border border-bad/40 text-bad hover:bg-bad-soft",
  }[variant];
  return (
    <button {...p} className={`inline-flex min-h-10 items-center justify-center rounded-lg px-4 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${v} ${className}`}>
      {children}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="font-medium">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const inputCls = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm num focus:border-accent focus:outline-none";

export const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");

export function Addr({ a }: { a?: string }) {
  if (!a) return <span>—</span>;
  return <a className="font-mono text-accent-strong underline-offset-2 hover:underline" href={addrUrl(a)} target="_blank" rel="noreferrer" title={a}>{short(a)}</a>;
}

export function TxLink({ hash }: { hash?: string }) {
  if (!hash) return null;
  return <a className="font-mono text-accent-strong underline-offset-2 hover:underline" href={txUrl(hash)} target="_blank" rel="noreferrer">{short(hash)} ↗</a>;
}

/** Display formatting only — all math happens in bigint upstream. */
export function fmt(x: bigint | string | undefined, decimals = 18, dp = 2): string {
  if (x === undefined) return "—";
  const v = typeof x === "string" ? BigInt(x) : x;
  if (v >= (1n << 255n)) return "∞";
  const s = formatUnits(v, decimals);
  const [i, f = ""] = s.split(".");
  const int = BigInt(i).toLocaleString("en-US");
  return dp > 0 ? `${int}.${(f + "0".repeat(dp)).slice(0, dp)}` : int;
}

export const pct = (wad: bigint | string | undefined) => (wad === undefined ? "—" : `${fmt(BigInt(wad) * 100n, 18, 2)}%`);
