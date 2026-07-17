"use client";

import { format } from "date-fns";
import { FolderOpen, Mail, Mic, Phone, Users } from "lucide-react";
import type { MouseEvent } from "react";
import { useArtifact } from "@/hooks/use-artifact";
import type { PatientSummary } from "@/lib/ai/tools/openemr";
import { cn, parseDateSafe } from "@/lib/utils";
import { EmptyStateCard } from "./empty-state-card";
import { patientOverviewArtifact } from "./patient-overview-artifact";

function formatDOB(dob: string) {
  const parsed = parseDateSafe(dob);
  return parsed ? format(parsed, "MMM d, yyyy") : dob;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

function PatientCard({
  patient,
  onSelect,
}: {
  patient: PatientSummary;
  onSelect?: (patient: PatientSummary) => void;
}) {
  const { setArtifact } = useArtifact();
  const location = [patient.city, patient.state].filter(Boolean).join(", ");
  const isActive = patient.status?.toLowerCase() === "active";
  const hasFields = patient.DOB || patient.sex || location;
  // The overview route needs both the uuid (envelope endpoints) and the
  // numeric pid (legacy endpoints) to aggregate the chart.
  const clickable = Boolean(patient.uuid && patient.pid);

  const openOverview = (event: MouseEvent<HTMLButtonElement>) => {
    setArtifact(
      patientOverviewArtifact(
        patient,
        event.currentTarget.getBoundingClientRect()
      )
    );
  };

  const body = (
    <>
      {/* Avatar with status ring */}
      <div
        className={cn(
          "mt-px flex size-[33px] shrink-0 items-center justify-center rounded-full bg-muted font-bold text-[10.5px] text-muted-foreground ring-offset-2 ring-offset-card",
          isActive ? "ring-2 ring-positive/35" : "ring-[1.5px] ring-border/50"
        )}
      >
        {initials(patient.name)}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {/* Name + status */}
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-semibold text-[13px] tracking-[-0.012em] text-foreground">
            {patient.name || "Unknown patient"}
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            {patient.status && (
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 font-semibold text-[10px] leading-none",
                  isActive
                    ? "bg-positive/10 text-positive"
                    : "text-muted-foreground/70"
                )}
              >
                <span
                  className={cn(
                    "size-[5px] shrink-0 rounded-full",
                    isActive ? "bg-positive" : "bg-muted-foreground/60"
                  )}
                />
                {patient.status}
              </span>
            )}
            {clickable &&
              (onSelect ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0.5 font-mono text-[9px] text-primary uppercase leading-none tracking-[0.08em] opacity-0 transition-opacity duration-150 group-focus-within/patient:opacity-100 group-hover/patient:opacity-100 pointer-coarse:opacity-100">
                  <Mic className="size-2.5" />
                  Scribe
                </span>
              ) : (
                <FolderOpen className="size-3.5 shrink-0 text-muted-foreground/60 opacity-0 transition-opacity duration-150 group-focus-within/patient:opacity-100 group-hover/patient:opacity-100 pointer-coarse:opacity-100" />
              ))}
          </span>
        </div>

        {/* Labeled field pairs — reads like a structured chart record */}
        {hasFields && (
          <div className="flex flex-wrap items-start gap-x-5 gap-y-1">
            {patient.DOB && (
              <div className="flex flex-col gap-0.5">
                <span className="text-[9px] font-bold uppercase tracking-[0.09em] text-muted-foreground/60">
                  DOB
                </span>
                <span className="tabular-nums text-[11.5px] text-muted-foreground">
                  {formatDOB(patient.DOB)}
                </span>
              </div>
            )}
            {patient.sex && (
              <div className="flex flex-col gap-0.5">
                <span className="text-[9px] font-bold uppercase tracking-[0.09em] text-muted-foreground/60">
                  SEX
                </span>
                <span className="text-[11.5px] text-muted-foreground">
                  {patient.sex}
                </span>
              </div>
            )}
            {location && (
              <div className="flex flex-col gap-0.5">
                <span className="text-[9px] font-bold uppercase tracking-[0.09em] text-muted-foreground/60">
                  LOCATION
                </span>
                <span className="text-[11.5px] text-muted-foreground">
                  {location}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Contact */}
        {(patient.phone || patient.email) && (
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-0.5">
            {patient.phone && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/60">
                <Phone className="size-[11px] shrink-0" />
                {patient.phone}
              </span>
            )}
            {patient.email && (
              <span className="inline-flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground/60">
                <Mail className="size-[11px] shrink-0" />
                <span className="truncate">{patient.email}</span>
              </span>
            )}
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className="group/patient flex overflow-hidden rounded-xl border border-border/50 bg-card shadow-(--shadow-card) transition-colors duration-150 hover:border-border">
      {/* Chart-folder tab: status encoded as left border color */}
      <div
        className={cn(
          "w-[3px] shrink-0 self-stretch",
          isActive ? "bg-positive" : "bg-muted-foreground/25"
        )}
      />

      {clickable ? (
        <button
          aria-label={
            onSelect
              ? `Select ${patient.name || "patient"}`
              : `Open chart overview for ${patient.name || "patient"}`
          }
          className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5 px-3 py-[11px] text-left focus-visible:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
          onClick={onSelect ? () => onSelect(patient) : openOverview}
          type="button"
        >
          {body}
        </button>
      ) : (
        <div
          className="flex min-w-0 flex-1 items-start gap-2.5 px-3 py-[11px]"
          title={
            onSelect
              ? "No chart linked — search for the patient instead"
              : undefined
          }
        >
          {body}
        </div>
      )}
    </div>
  );
}

export function Patients({
  patients,
  onSelectPatient,
}: {
  patients: PatientSummary[];
  /** When set, clicking a card calls this instead of opening the
   * patient-overview artifact — used by the scribe session picker. */
  onSelectPatient?: (patient: PatientSummary) => void;
}) {
  if (patients.length === 0) {
    return (
      <EmptyStateCard>
        No patients matched your search. Try a different name or ID.
      </EmptyStateCard>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 px-0.5 font-mono text-[10px] text-muted-foreground/70 uppercase tracking-[0.08em]">
        <Users className="size-3.5" />
        {patients.length} patient{patients.length === 1 ? "" : "s"} found
      </div>
      {patients.map((patient) => (
        <PatientCard
          key={patient.uuid ?? patient.pid}
          onSelect={onSelectPatient}
          patient={patient}
        />
      ))}
    </div>
  );
}
