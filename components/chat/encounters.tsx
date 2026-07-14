"use client";

import { format } from "date-fns";
import {
  Building2,
  CalendarClock,
  ChevronDown,
  Clock,
  HeartPulse,
  Pencil,
  User,
} from "lucide-react";
import { type MouseEvent, useState } from "react";
import type { SoapArtifactPayload } from "@/artifacts/soap/client";
import { useArtifact } from "@/hooks/use-artifact";
import type { VitalSummary } from "@/lib/ai/tools/openemr";
import type { Encounter, SoapNote } from "@/lib/openemr/types";
import type { ChatTools } from "@/lib/types";
import { cn, parseDateSafe } from "@/lib/utils";
import { EmptyStateCard } from "./empty-state-card";
import { SoapNoteBody } from "./soap-note";

// Embedded by the getEncounters tool; null means the encounter has none.
type EncounterWithDetails = Encounter & {
  soapNote: SoapNote | null;
  vitals: VitalSummary | null;
};

// Label/value/unit per measurement; entries with no recorded value are
// dropped, and blood pressure folds bps/bpd into one reading.
function toVitalItems(vitals: VitalSummary) {
  return [
    {
      label: "BP",
      value:
        vitals.bps !== null &&
        vitals.bps !== undefined &&
        vitals.bpd !== null &&
        vitals.bpd !== undefined
          ? `${vitals.bps}/${vitals.bpd}`
          : null,
      unit: "mmHg",
    },
    { label: "Pulse", value: vitals.pulse, unit: "bpm" },
    { label: "Temp", value: vitals.temperature, unit: "°F" },
    { label: "SpO2", value: vitals.oxygen_saturation, unit: "%" },
    { label: "Wt", value: vitals.weight, unit: "lb" },
  ].filter((item) => item.value !== null && item.value !== undefined);
}

export function EncounterVitals({ vitals }: { vitals: VitalSummary }) {
  const items = toVitalItems(vitals);

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
      <HeartPulse className="size-[11px] shrink-0 text-muted-foreground/40" />
      {items.map((item) => (
        <span className="flex items-baseline gap-1" key={item.label}>
          <span className="font-bold text-[9px] text-muted-foreground/40 uppercase tracking-[0.09em]">
            {item.label}
          </span>
          <span className="font-mono text-[12px] text-foreground tabular-nums">
            {item.value}
            <span className="text-muted-foreground/60"> {item.unit}</span>
          </span>
        </span>
      ))}
    </div>
  );
}

function EncounterSoapNote({ eid, note }: { eid: number; note: SoapNote }) {
  const { setArtifact } = useArtifact();

  const openEditor = (event: MouseEvent<HTMLButtonElement>) => {
    const boundingBox = event.currentTarget.getBoundingClientRect();
    const payload: SoapArtifactPayload = { eid, note };
    const parsedDate = parseDateSafe(note.date);

    setArtifact({
      documentId: `soap-note:${note.pid}:${eid}:${note.id}`,
      kind: "soap",
      content: JSON.stringify(payload),
      title: parsedDate
        ? `SOAP Note · ${format(parsedDate, "MMM d, yyyy")}`
        : "SOAP Note",
      isVisible: true,
      status: "idle",
      boundingBox: {
        top: boundingBox.top,
        left: boundingBox.left,
        width: boundingBox.width,
        height: boundingBox.height,
      },
    });
  };

  return (
    <div className="relative">
      <button
        aria-label="Edit SOAP note"
        className="absolute top-0 right-0 inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 font-medium text-[11px] text-muted-foreground/60 leading-none transition-colors hover:bg-muted hover:text-foreground"
        onClick={openEditor}
        type="button"
      >
        <Pencil className="size-[11px] shrink-0" />
        Edit
      </button>
      <SoapNoteBody soapNote={note} />
    </div>
  );
}

// The month/day tile leading an encounter card; falls back to a calendar
// icon when the date can't be parsed.
function EncounterDateBlock({ date }: { date: Date | null }) {
  return (
    <div className="mt-px flex size-[33px] shrink-0 flex-col items-center justify-center rounded-lg bg-encounter/10 text-encounter ring-[1.5px] ring-encounter/25">
      {date ? (
        <>
          <span className="font-bold text-[8px] uppercase leading-none tracking-wide">
            {format(date, "MMM")}
          </span>
          <span className="font-bold text-[14px] leading-none tabular-nums">
            {format(date, "d")}
          </span>
        </>
      ) : (
        <CalendarClock className="size-[15px]" />
      )}
    </div>
  );
}

function EncounterCard({ encounter }: { encounter: EncounterWithDetails }) {
  const parsedDate = parseDateSafe(encounter.date);
  const [expanded, setExpanded] = useState(false);
  const expandable = Boolean(encounter.soapNote);

  const body = (
    <>
      <EncounterDateBlock date={parsedDate} />

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-semibold text-[13px] tracking-[-0.012em] text-foreground">
            {encounter.reason || "Encounter"}
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            {encounter.pc_catname && (
              <span className="inline-flex items-center rounded-full bg-encounter/10 px-1.5 py-0.5 font-semibold text-[10px] text-encounter leading-none">
                {encounter.pc_catname}
              </span>
            )}
            {expandable && (
              <ChevronDown
                className={cn(
                  "size-3.5 text-muted-foreground/50 transition-transform duration-200",
                  expanded && "rotate-180"
                )}
              />
            )}
          </span>
        </div>

        <div className="flex items-center gap-1 text-[12px] text-muted-foreground tabular-nums">
          <Clock className="size-[11px] shrink-0" />
          {parsedDate
            ? format(parsedDate, "MMM d, yyyy · h:mm a")
            : encounter.date}
        </div>

        {encounter.facility_name && (
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-0.5">
            <span className="inline-flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground/60">
              <Building2 className="size-[11px] shrink-0" />
              <span className="truncate">{encounter.facility_name}</span>
            </span>
          </div>
        )}

        {encounter.vitals && <EncounterVitals vitals={encounter.vitals} />}
      </div>
    </>
  );

  return (
    <div className="flex overflow-hidden rounded-xl border border-border/50 bg-card shadow-(--shadow-card) transition-[border-color,transform] duration-150 hover:-translate-y-px hover:border-border">
      <div className="w-[3px] shrink-0 self-stretch bg-encounter/70" />

      <div className="flex min-w-0 flex-1 flex-col">
        {expandable ? (
          <button
            aria-expanded={expanded}
            className="flex min-w-0 cursor-pointer items-start gap-2.5 px-3 py-[11px] text-left"
            onClick={() => setExpanded((current) => !current)}
            type="button"
          >
            {body}
          </button>
        ) : (
          <div className="flex min-w-0 items-start gap-2.5 px-3 py-[11px]">
            {body}
          </div>
        )}

        {expanded && encounter.soapNote && (
          <div className="border-border/50 border-t px-3 py-[11px]">
            <EncounterSoapNote eid={encounter.eid} note={encounter.soapNote} />
          </div>
        )}
      </div>
    </div>
  );
}

type CreateEncounterInput = ChatTools["createEncounter"]["input"];

// Preview of a `createEncounter` call awaiting user approval, rendered in the
// same visual language as EncounterCard. Everything is shown inline (no
// expand/collapse) — the user is reviewing exactly what will be written to
// OpenEMR, so nothing may hide behind a click.
export function PendingEncounterCard({
  input,
}: {
  input: CreateEncounterInput;
}) {
  // Mirrors the server-side default in the createEncounter tool.
  const date = input.date ?? new Date().toISOString().slice(0, 10);
  const parsedDate = parseDateSafe(date);

  const vitals: VitalSummary | null = input.vitals
    ? {
        date,
        bps: input.vitals.bps ?? null,
        bpd: input.vitals.bpd ?? null,
        weight: input.vitals.weight ?? null,
        height: input.vitals.height ?? null,
        temperature: input.vitals.temperature ?? null,
        pulse: input.vitals.pulse ?? null,
        respiration: input.vitals.respiration ?? null,
        oxygen_saturation: input.vitals.oxygenSaturation ?? null,
      }
    : null;

  const soapSections = [
    input.soapNote?.subjective,
    input.soapNote?.objective,
    input.soapNote?.assessment,
    input.soapNote?.plan,
  ];
  const soapNote: SoapNote | null = soapSections.some(Boolean)
    ? {
        id: 0,
        pid: input.patient.pid,
        date,
        user: "",
        authorized: 0,
        activity: 1,
        subjective: input.soapNote?.subjective ?? "",
        objective: input.soapNote?.objective ?? "",
        assessment: input.soapNote?.assessment ?? "",
        plan: input.soapNote?.plan ?? "",
      }
    : null;

  return (
    <div className="flex overflow-hidden rounded-xl border border-border/50 bg-card shadow-(--shadow-card)">
      <div className="w-[3px] shrink-0 self-stretch bg-encounter/70" />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-w-0 items-start gap-2.5 px-3 py-[11px]">
          <EncounterDateBlock date={parsedDate} />

          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-semibold text-[13px] tracking-[-0.012em] text-foreground">
                {input.reason || "Encounter"}
              </span>
              <span className="inline-flex shrink-0 items-center rounded-full bg-encounter/10 px-1.5 py-0.5 font-semibold text-[10px] text-encounter leading-none">
                Office Visit
              </span>
            </div>

            <div className="flex items-center gap-1 text-[12px] text-muted-foreground">
              <User className="size-[11px] shrink-0" />
              <span className="truncate">{input.patient.name}</span>
            </div>

            <div className="flex items-center gap-1 text-[12px] text-muted-foreground tabular-nums">
              <Clock className="size-[11px] shrink-0" />
              {parsedDate ? format(parsedDate, "MMM d, yyyy") : date}
            </div>

            {vitals && <EncounterVitals vitals={vitals} />}
          </div>
        </div>

        {soapNote && (
          <div className="border-border/50 border-t px-3 py-[11px]">
            <SoapNoteBody soapNote={soapNote} />
          </div>
        )}
      </div>
    </div>
  );
}

export function Encounters({
  encounters,
}: {
  encounters: EncounterWithDetails[];
}) {
  if (encounters.length === 0) {
    return (
      <EmptyStateCard>No encounters found for this patient.</EmptyStateCard>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="flex items-center gap-1.5 px-0.5 font-mono font-normal text-[10px] text-muted-foreground/50 uppercase tracking-[0.08em]">
        <CalendarClock aria-hidden="true" className="size-3.5" />
        Encounters
        <span className="text-muted-foreground/35 tabular-nums">
          · {encounters.length}
        </span>
      </h3>
      {encounters.map((encounter) => (
        <EncounterCard
          encounter={encounter}
          key={encounter.euuid ?? encounter.eid}
        />
      ))}
    </div>
  );
}
