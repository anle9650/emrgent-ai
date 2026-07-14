"use client";

import { format } from "date-fns";
import {
  ClipboardList,
  type LucideIcon,
  Pill,
  Slice,
  User,
} from "lucide-react";
import type { MedicalIssueSummary } from "@/lib/ai/tools/openemr";
import type { ChatTools } from "@/lib/types";
import { cn, parseDateSafe } from "@/lib/utils";
import { EmptyStateCard } from "./empty-state-card";

export type MedicalIssueKind = "problems" | "medications" | "surgeries";

// Accent classes are written out per kind because Tailwind only picks up
// complete class strings. `ongoing` marks kinds that describe a state over
// time (problems, medications) and so get an Active/Resolved pill and a
// "Since …" date; surgeries are one-time events and show only their date.
const KIND_CONFIG: Record<
  MedicalIssueKind,
  {
    icon: LucideIcon;
    plural: string;
    empty: string;
    ongoing: boolean;
    stripClass: string;
  }
> = {
  problems: {
    icon: ClipboardList,
    plural: "medical problems",
    empty: "No medical problems on file.",
    ongoing: true,
    stripClass: "bg-problem/70",
  },
  medications: {
    icon: Pill,
    plural: "medications",
    empty: "No medications on file.",
    ongoing: true,
    stripClass: "bg-medication/70",
  },
  surgeries: {
    icon: Slice,
    plural: "surgeries",
    empty: "No surgeries on file.",
    ongoing: false,
    stripClass: "bg-surgery/70",
  },
};

function formatIssueDate(raw: string | null) {
  if (!raw) {
    return null;
  }
  const parsed = parseDateSafe(raw);
  return parsed ? format(parsed, "MMM d, yyyy") : raw;
}

// The tool normalizes diagnosis to {code, description}[]; the Array.isArray
// guard keeps tool outputs persisted before that normalization from crashing
// the render (they just show no badges).
function diagnosisCodes(diagnosis: MedicalIssueSummary["diagnosis"]) {
  return Array.isArray(diagnosis) ? diagnosis : [];
}

function IssueRow({
  issue,
  ongoing,
}: {
  issue: MedicalIssueSummary;
  ongoing: boolean;
}) {
  const begdate = formatIssueDate(issue.begdate);
  const enddate = formatIssueDate(issue.enddate);
  const codes = diagnosisCodes(issue.diagnosis);
  // One-time events (surgeries) show a plain date; ongoing issues read as a
  // period ("Since …" while open, a range once resolved).
  let dateLabel = begdate;
  if (begdate && ongoing) {
    dateLabel = enddate ? `${begdate} – ${enddate}` : `Since ${begdate}`;
  }

  return (
    <div className="flex min-w-0 flex-col gap-1 px-3 py-[11px]">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-semibold text-[13px] text-foreground tracking-[-0.012em]">
          {issue.title || "Untitled entry"}
        </span>
        {ongoing && (
          <span
            className={cn(
              "inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 font-semibold text-[10px] leading-none",
              issue.active
                ? "bg-positive/10 text-positive"
                : "bg-muted text-muted-foreground/70"
            )}
          >
            {issue.active ? "Active" : "Resolved"}
          </span>
        )}
      </div>

      {(dateLabel || codes.length > 0) && (
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
          {dateLabel && (
            <span className="text-[11px] text-muted-foreground/60 tabular-nums">
              {dateLabel}
            </span>
          )}
          {codes.map((diagnosis) => (
            <span
              className="inline-flex items-center rounded-[5px] bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/70 uppercase tracking-[0.04em]"
              key={diagnosis.code}
              title={diagnosis.description ?? undefined}
            >
              {diagnosis.code}
            </span>
          ))}
        </div>
      )}

      {issue.comments && (
        <p className="text-[11px] text-muted-foreground/60 leading-snug">
          {issue.comments}
        </p>
      )}
    </div>
  );
}

type MedicalProblemWriteInput =
  | ChatTools["createMedicalProblem"]["input"]
  | ChatTools["updateMedicalProblem"]["input"];

// Preview of a `createMedicalProblem`/`updateMedicalProblem` call awaiting
// user approval, rendered in the same visual language as the problems list.
// Everything is shown inline — the user is reviewing exactly what will be
// written to OpenEMR, so nothing may hide behind a click.
export function PendingMedicalProblemCard({
  input,
}: {
  input: MedicalProblemWriteInput;
}) {
  // An update previews the finalized record: the problem's current summary
  // (echoed from getMedicalProblems as `input.problem`) with the changed
  // fields laid over it — an omitted field means "leave unchanged", while an
  // explicit `enddate: null` clears the resolution date, mirroring how the
  // tool builds the PUT body. A create has no current record; an omitted
  // begdate defaults to today like the server-side default in the tool.
  const current = "problem" in input ? input.problem : null;
  const begdate =
    input.begdate ??
    (current ? current.begdate : new Date().toISOString().slice(0, 10));
  const enddate =
    input.enddate === undefined ? (current?.enddate ?? null) : input.enddate;
  const issue: MedicalIssueSummary = {
    title: input.title ?? current?.title ?? "",
    begdate,
    enddate,
    active: !enddate,
    diagnosis:
      input.diagnosis === undefined
        ? (current?.diagnosis ?? [])
        : [{ code: input.diagnosis, description: null }],
    comments: "",
  };

  return (
    <div className="flex overflow-hidden rounded-xl border border-border/50 bg-card shadow-(--shadow-card)">
      <div className="w-[3px] shrink-0 self-stretch bg-problem/70" />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-1 border-border/40 border-b px-3 py-[9px] text-[12px] text-muted-foreground">
          <User className="size-[11px] shrink-0" />
          <span className="truncate">{input.patient.name}</span>
        </div>

        <IssueRow issue={issue} ongoing={true} />
      </div>
    </div>
  );
}

export function MedicalIssues({
  issues,
  kind,
}: {
  issues: MedicalIssueSummary[];
  kind: MedicalIssueKind;
}) {
  const config = KIND_CONFIG[kind];
  const Icon = config.icon;

  if (issues.length === 0) {
    return <EmptyStateCard>{config.empty}</EmptyStateCard>;
  }

  // Active entries first (meaningless for one-time events), then most
  // recent first.
  const sorted = [...issues].sort((a, b) => {
    if (config.ongoing && a.active !== b.active) {
      return a.active ? -1 : 1;
    }
    return (b.begdate ?? "").localeCompare(a.begdate ?? "");
  });

  return (
    <div className="flex flex-col gap-2">
      <h3 className="flex items-center gap-1.5 px-0.5 font-mono font-normal text-[10px] text-muted-foreground/50 uppercase tracking-[0.08em]">
        <Icon aria-hidden="true" className="size-3.5" />
        {config.plural}
        <span className="text-muted-foreground/35 tabular-nums">
          · {issues.length}
        </span>
      </h3>

      <div className="flex overflow-hidden rounded-xl border border-border/50 bg-card shadow-(--shadow-card)">
        <div
          className={cn("w-[3px] shrink-0 self-stretch", config.stripClass)}
        />
        <div className="flex min-w-0 flex-1 flex-col divide-y divide-border/40">
          {sorted.map((issue, index) => (
            <IssueRow
              issue={issue}
              key={`${issue.title}-${issue.begdate ?? index}`}
              ongoing={config.ongoing}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
