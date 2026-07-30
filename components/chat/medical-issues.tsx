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

// One field's before/after for an update preview. `null` renders as an
// em-dash so a cleared/absent value still reads as a value.
type IssueChange = {
  label: string;
  before: string | null;
  after: string | null;
};

// Diff the current record against the merged result for an update preview.
// Only fields that actually differ produce a change; the caller opts into
// status (Active/Resolved, derived from `enddate`) and diagnosis since those
// don't apply to every kind. Dates are compared on their raw value but shown
// formatted. Returns [] when nothing changed, so the card falls back to the
// plain merged view.
function computeIssueChanges(
  current: MedicalIssueSummary,
  next: MedicalIssueSummary,
  {
    includeStatus,
    includeDiagnosis,
  }: {
    includeStatus: boolean;
    includeDiagnosis: boolean;
  }
): IssueChange[] {
  const changes: IssueChange[] = [];

  if ((current.title ?? "") !== (next.title ?? "")) {
    changes.push({ label: "Name", before: current.title, after: next.title });
  }

  if (includeStatus && current.active !== next.active) {
    changes.push({
      label: "Status",
      before: current.active ? "Active" : "Resolved",
      after: next.active ? "Active" : "Resolved",
    });
  }

  if ((current.begdate ?? "") !== (next.begdate ?? "")) {
    changes.push({
      label: "Onset",
      before: formatIssueDate(current.begdate),
      after: formatIssueDate(next.begdate),
    });
  }

  if ((current.enddate ?? "") !== (next.enddate ?? "")) {
    changes.push({
      label: "Resolved",
      before: formatIssueDate(current.enddate),
      after: formatIssueDate(next.enddate),
    });
  }

  if (includeDiagnosis) {
    const codesOf = (issue: MedicalIssueSummary) =>
      diagnosisCodes(issue.diagnosis)
        .map((d) => d.code)
        .join(", ");
    const before = codesOf(current);
    const after = codesOf(next);
    if (before !== after) {
      changes.push({
        label: "Code",
        before: before || null,
        after: after || null,
      });
    }
  }

  return changes;
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

// The before → after diff of an update, shown below the merged IssueRow so the
// clinician can verify exactly what's changing. The delta is the visual focus:
// the old value is muted and struck through, the new value is emphasized.
function IssueChanges({ changes }: { changes: IssueChange[] }) {
  if (changes.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1 border-border/40 border-t px-3 py-[11px]">
      {changes.map((change) => (
        <div
          className="flex items-baseline gap-2 text-[12px]"
          key={change.label}
        >
          <span className="w-14 shrink-0 font-mono text-[10px] text-muted-foreground/50 uppercase tracking-[0.08em]">
            {change.label}
          </span>
          <span className="min-w-0 truncate text-muted-foreground/50 line-through">
            {change.before ?? "—"}
          </span>
          <span
            aria-hidden="true"
            className="shrink-0 text-muted-foreground/40"
          >
            →
          </span>
          <span className="min-w-0 truncate font-semibold text-foreground">
            {change.after ?? "—"}
          </span>
        </div>
      ))}
    </div>
  );
}

// Shared chrome for the write-approval previews: accent strip, the patient
// whose chart is being written to, and the merged record via IssueRow.
// Everything is shown inline — the user is reviewing exactly what will be
// written to OpenEMR, so nothing may hide behind a click. On an update
// (`changes` present) an "Updated" badge marks it as an edit and the before →
// after diff is shown below the merged record.
function PendingIssueCard({
  stripClass,
  accentBadgeClass,
  patientName,
  issue,
  ongoing = true,
  changes,
}: {
  stripClass: string;
  accentBadgeClass?: string;
  patientName: string;
  issue: MedicalIssueSummary;
  ongoing?: boolean;
  changes?: IssueChange[];
}) {
  const isUpdate = changes !== undefined;

  return (
    <div className="flex overflow-hidden rounded-xl border border-border/50 bg-card shadow-(--shadow-card)">
      <div className={cn("w-[3px] shrink-0 self-stretch", stripClass)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-1.5 border-border/40 border-b px-3 py-[9px] text-[12px] text-muted-foreground">
          <User className="size-[11px] shrink-0" />
          <span className="min-w-0 truncate">{patientName}</span>
          {isUpdate && (
            <span
              className={cn(
                "ml-auto inline-flex shrink-0 items-center rounded-[5px] px-1.5 py-0.5 font-mono font-semibold text-[10px] uppercase leading-none tracking-[0.08em]",
                accentBadgeClass ?? "bg-muted text-muted-foreground/70"
              )}
            >
              Updated
            </span>
          )}
        </div>

        <IssueRow issue={issue} ongoing={ongoing} />

        {isUpdate && <IssueChanges changes={changes} />}
      </div>
    </div>
  );
}

type MedicalProblemWriteInput =
  | ChatTools["createMedicalProblem"]["input"]
  | ChatTools["updateMedicalProblem"]["input"];

// Preview of a `createMedicalProblem`/`updateMedicalProblem` call awaiting
// user approval, rendered in the same visual language as the problems list.
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
    <PendingIssueCard
      accentBadgeClass="bg-problem/10 text-problem"
      changes={
        current
          ? computeIssueChanges(
              { ...current, active: !current.enddate, comments: "" },
              issue,
              { includeStatus: true, includeDiagnosis: true }
            )
          : undefined
      }
      issue={issue}
      patientName={input.patient.name}
      stripClass="bg-problem/70"
    />
  );
}

type MedicationWriteInput =
  | ChatTools["createMedication"]["input"]
  | ChatTools["updateMedication"]["input"];

// Preview of a `createMedication`/`updateMedication` call awaiting user
// approval. Same merge semantics as the problem preview: an update lays the
// changed fields over the medication's current summary (echoed from
// getMedications as `input.medication`), with an explicit `enddate: null`
// clearing the discontinuation date; a create defaults an omitted begdate to
// today like the server-side default in the tool.
export function PendingMedicationCard({
  input,
}: {
  input: MedicationWriteInput;
}) {
  const current = "medication" in input ? input.medication : null;
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
    // Medication writes can't change codes; an update carries the current
    // ones through (the legacy PUT re-writes them), a create has none.
    diagnosis: current?.diagnosis ?? [],
    comments: "",
  };

  return (
    <PendingIssueCard
      accentBadgeClass="bg-medication/10 text-medication"
      changes={
        current
          ? computeIssueChanges(
              { ...current, active: !current.enddate, comments: "" },
              issue,
              { includeStatus: true, includeDiagnosis: false }
            )
          : undefined
      }
      issue={issue}
      patientName={input.patient.name}
      stripClass="bg-medication/70"
    />
  );
}

// Preview of a `createSurgery` call awaiting user approval. Surgeries are
// one-time events (`ongoing: false` — plain date, no Active/Resolved pill);
// an omitted begdate defaults to today like the server-side default in the
// tool.
export function PendingSurgeryCard({
  input,
}: {
  input: ChatTools["createSurgery"]["input"];
}) {
  const begdate = input.begdate ?? new Date().toISOString().slice(0, 10);
  const issue: MedicalIssueSummary = {
    title: input.title,
    begdate,
    enddate: input.enddate ?? null,
    active: !input.enddate,
    diagnosis: input.diagnosis
      ? [{ code: input.diagnosis, description: null }]
      : [],
    comments: "",
  };

  return (
    <PendingIssueCard
      issue={issue}
      ongoing={false}
      patientName={input.patient.name}
      stripClass="bg-surgery/70"
    />
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
