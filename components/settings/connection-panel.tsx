import { cn } from "@/lib/utils";
import { type LineState, LineStatus } from "./line-status";

/**
 * The shell for the OpenEMR connection panel: a card with a header rail
 * carrying the line-status lamp, and a ruled spine running down the steps.
 *
 * Connecting is a genuine dependency-ordered procedure — register a client in
 * OpenEMR, then hand its credentials over here — and the second step is
 * unreachable until the first lands. The numbering and the spine encode that
 * order; each completed segment of the rule is drawn in gold, so the spine
 * shows how far the line is wired.
 */
export function ConnectionPanel({
  title,
  description,
  lineState,
  notice,
  children,
  footer,
}: {
  title: string;
  description?: React.ReactNode;
  lineState: LineState;
  /** A band between the header and step I — anything that qualifies the
   * procedure has to be read before it, not after. */
  notice?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-[var(--shadow-card)]">
      <header className="flex flex-wrap items-center justify-between gap-4 border-border/60 border-b px-5 py-4 md:px-7">
        <div className="flex flex-col gap-1">
          <h1 className="font-bold font-display text-xl tracking-[0.02em]">
            {title}
          </h1>
          {description && (
            <p className="max-w-prose text-[13px] text-muted-foreground leading-relaxed">
              {description}
            </p>
          )}
        </div>
        <LineStatus state={lineState} />
      </header>

      {notice && (
        <div className="border-border/60 border-b bg-muted/30 px-5 py-4 md:px-7">
          {notice}
        </div>
      )}

      <ol className="flex flex-col px-5 py-2 md:px-7">{children}</ol>

      {footer && (
        <footer className="border-border/60 border-t bg-muted/30 px-5 py-4 md:px-7">
          {footer}
        </footer>
      )}
    </section>
  );
}

export type StepState = "done" | "active" | "blocked";

// The rule arriving at a step is gold once the line has been wired that far —
// which, given the steps are strictly ordered, is exactly when this step is no
// longer blocked. The first step has nothing arriving at it.
function inboundSegmentTone(first: boolean, blocked: boolean) {
  if (first) {
    return "bg-transparent";
  }
  return blocked ? "bg-border" : "bg-primary/40";
}

export function ConnectionStep({
  numeral,
  title,
  hint,
  state,
  first = false,
  last = false,
  children,
}: {
  numeral: string;
  title: string;
  hint?: React.ReactNode;
  state: StepState;
  first?: boolean;
  last?: boolean;
  children?: React.ReactNode;
}) {
  const blocked = state === "blocked";

  return (
    <li
      // Blocked steps stay readable — the user needs to see what's coming —
      // but are announced as unavailable and hold no reachable controls.
      aria-disabled={blocked || undefined}
      className="relative grid grid-cols-[1.5rem_1fr] gap-x-4"
    >
      {/* Spine: the rule arriving from the step above, the marker, then the
          rule running down to the next. A segment is drawn in gold once the
          line has been wired that far. */}
      <div className="flex flex-col items-center">
        <span
          aria-hidden
          className={cn(
            "h-6 w-px shrink-0 transition-colors",
            inboundSegmentTone(first, blocked)
          )}
        />
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-[10px] tracking-[0.04em] transition-colors",
            state === "done" &&
              "border-primary bg-primary text-primary-foreground",
            state === "active" && "border-primary bg-background text-primary",
            blocked && "border-border bg-background text-muted-foreground/50"
          )}
        >
          {numeral}
        </span>
        {!last && (
          <span
            aria-hidden
            className={cn(
              "w-px flex-1 transition-colors",
              state === "done" ? "bg-primary/40" : "bg-border"
            )}
          />
        )}
      </div>

      {/* min-w-0: without it a 1fr grid track floors at its content's
          intrinsic width, and the long single-line values in step I push the
          whole panel wider than the viewport on mobile instead of scrolling
          inside their own box. */}
      <div className={cn("min-w-0 pt-6", last ? "pb-6" : "pb-8")}>
        <h2
          className={cn(
            "font-mono text-[10px] uppercase tracking-[0.14em]",
            blocked ? "text-muted-foreground/50" : "text-muted-foreground"
          )}
        >
          {title}
        </h2>
        {hint && (
          <p
            className={cn(
              "mt-1.5 max-w-prose text-[13px] leading-relaxed",
              blocked ? "text-muted-foreground/60" : "text-muted-foreground"
            )}
          >
            {hint}
          </p>
        )}
        {children && <div className="mt-4">{children}</div>}
      </div>
    </li>
  );
}
