"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { formatValue, getPath } from "./resolve";

export type Tone = "neutral" | "positive" | "warning" | "critical";

const TONE_STRIPE: Record<Tone, string> = {
  neutral: "bg-muted-foreground/25",
  positive: "bg-emerald-500",
  warning: "bg-amber-500",
  critical: "bg-rose-500",
};

const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-muted-foreground",
  positive: "text-emerald-600 dark:text-emerald-400",
  warning: "text-amber-600 dark:text-amber-400",
  critical: "text-rose-600 dark:text-rose-400",
};

const TONE_BADGE: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  positive: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  critical: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
};

const GAP: Record<"sm" | "md" | "lg", string> = {
  sm: "gap-1.5",
  md: "gap-2.5",
  lg: "gap-4",
};

const LABEL_CLASS =
  "font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground/60";

// Shown in place of anything the surface references but the client can't
// resolve — a missing tool call, a failed source, a non-array table binding.
export function UnavailableChip({ reason }: { reason?: string }) {
  return (
    <span
      className="inline-flex w-fit items-center rounded-[5px] border border-border/50 bg-muted/50 px-2 py-1 font-mono text-[10px] text-muted-foreground/70 uppercase tracking-[0.08em]"
      title={reason}
    >
      data unavailable
    </span>
  );
}

export function A2Card({
  title,
  accent,
  children,
}: {
  title?: string;
  accent?: Tone;
  children: ReactNode;
}) {
  return (
    <div className="flex overflow-hidden rounded-xl border border-border/50 bg-card shadow-(--shadow-card)">
      {accent && (
        <div
          className={cn("w-[3px] shrink-0 self-stretch", TONE_STRIPE[accent])}
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-2.5 px-3.5 py-3">
        {title && (
          <div className={cn("border-border/40 border-b pb-2", LABEL_CLASS)}>
            {title}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export function A2Row({
  gap = "md",
  children,
}: {
  gap?: "sm" | "md" | "lg";
  children: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col sm:flex-row", GAP[gap])}>{children}</div>
  );
}

// Each Row child gets an equal-width column so side-by-side comparisons line
// up regardless of content.
export function A2RowItem({ children }: { children: ReactNode }) {
  return <div className="min-w-0 flex-1 sm:basis-0">{children}</div>;
}

export function A2Column({
  gap = "md",
  children,
}: {
  gap?: "sm" | "md" | "lg";
  children: ReactNode;
}) {
  return <div className={cn("flex flex-col", GAP[gap])}>{children}</div>;
}

export function A2List({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col divide-y divide-border/40">{children}</div>
  );
}

export function A2ListItem({ children }: { children: ReactNode }) {
  return <div className="py-1.5 first:pt-0 last:pb-0">{children}</div>;
}

export function A2Divider() {
  return <div className="border-border/40 border-t" />;
}

const TEXT_VARIANTS = {
  heading:
    "font-display font-bold text-[14px] text-foreground tracking-[0.02em]",
  body: "text-[13px] text-foreground leading-relaxed",
  muted: "text-[12px] text-muted-foreground",
  label: LABEL_CLASS,
} as const;

export function A2Text({
  variant = "body",
  children,
}: {
  variant?: keyof typeof TEXT_VARIANTS;
  children: string;
}) {
  return <div className={TEXT_VARIANTS[variant]}>{children}</div>;
}

export function A2Stat({
  label,
  value,
  unit,
  delta,
  tone = "neutral",
}: {
  label: string;
  value: string;
  unit?: string;
  delta?: string;
  tone?: Tone;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className={LABEL_CLASS}>{label}</span>
      <span className="font-semibold text-[17px] text-foreground tabular-nums">
        {value}
        {unit && (
          <span className="ml-1 font-normal text-[11px] text-muted-foreground">
            {unit}
          </span>
        )}
      </span>
      {delta !== undefined && (
        <span className={cn("text-[11px] tabular-nums", TONE_TEXT[tone])}>
          {delta}
        </span>
      )}
    </div>
  );
}

export function A2Badge({
  text,
  tone = "neutral",
}: {
  text: string;
  tone?: Tone;
}) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center rounded-[5px] px-1.5 py-0.5 font-semibold text-[10px] leading-none",
        TONE_BADGE[tone]
      )}
    >
      {text}
    </span>
  );
}

export function A2Table({
  columns,
  rows,
}: {
  columns: { header: string; path: string }[];
  rows: unknown[];
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border/50">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-border/50 border-b bg-muted/40">
            {columns.map((column) => (
              <th
                className="px-2.5 py-1.5 text-left font-bold font-mono text-[9.5px] text-muted-foreground/60 uppercase tracking-[0.09em]"
                key={column.header}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/30">
          {rows.map((row, rowIndex) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional data with no stable id.
            <tr key={rowIndex}>
              {columns.map((column) => (
                <td
                  className="px-2.5 py-1.5 text-muted-foreground tabular-nums"
                  key={column.header}
                >
                  {formatValue(getPath(row, column.path))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
