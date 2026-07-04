"use client";

import { format } from "date-fns";
import { Mail, Phone, Users } from "lucide-react";
import type { PatientSummary } from "@/lib/ai/tools/openemr";
import { cn, parseDateSafe } from "@/lib/utils";
import { EmptyStateCard } from "./empty-state-card";

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

function PatientCard({ patient }: { patient: PatientSummary }) {
  const location = [patient.city, patient.state].filter(Boolean).join(", ");
  const isActive = patient.status?.toLowerCase() === "active";
  const hasFields = patient.DOB || patient.sex || location;

  return (
    <div className="flex overflow-hidden rounded-xl border border-border/50 bg-card shadow-(--shadow-card) transition-[border-color,transform] duration-150 hover:-translate-y-px hover:border-border">
      {/* Chart-folder tab: status encoded as left border color */}
      <div
        className={cn(
          "w-[3px] shrink-0 self-stretch",
          isActive ? "bg-emerald-500" : "bg-muted-foreground/25"
        )}
      />

      <div className="flex min-w-0 flex-1 items-start gap-2.5 px-3 py-[11px]">
        {/* Avatar with status ring */}
        <div
          className={cn(
            "mt-px flex size-[33px] shrink-0 items-center justify-center rounded-full bg-muted font-bold text-[10.5px] text-muted-foreground ring-offset-2 ring-offset-card",
            isActive
              ? "ring-2 ring-emerald-500/35"
              : "ring-[1.5px] ring-border/50"
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
            {patient.status && (
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 font-semibold text-[10px] leading-none",
                  isActive
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "text-muted-foreground/50"
                )}
              >
                <span
                  className={cn(
                    "size-[5px] shrink-0 rounded-full",
                    isActive ? "bg-emerald-500" : "bg-muted-foreground/40"
                  )}
                />
                {patient.status}
              </span>
            )}
          </div>

          {/* Labeled field pairs — reads like a structured chart record */}
          {hasFields && (
            <div className="flex flex-wrap items-start gap-x-5 gap-y-1">
              {patient.DOB && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-[9px] font-bold uppercase tracking-[0.09em] text-muted-foreground/40">
                    DOB
                  </span>
                  <span className="tabular-nums text-[11.5px] text-muted-foreground">
                    {formatDOB(patient.DOB)}
                  </span>
                </div>
              )}
              {patient.sex && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-[9px] font-bold uppercase tracking-[0.09em] text-muted-foreground/40">
                    SEX
                  </span>
                  <span className="text-[11.5px] text-muted-foreground">
                    {patient.sex}
                  </span>
                </div>
              )}
              {location && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-[9px] font-bold uppercase tracking-[0.09em] text-muted-foreground/40">
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
      </div>
    </div>
  );
}

export function Patients({ patients }: { patients: PatientSummary[] }) {
  if (patients.length === 0) {
    return (
      <EmptyStateCard>
        No patients matched your search. Try a different name or ID.
      </EmptyStateCard>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 px-0.5 text-[11px] font-medium uppercase tracking-[0.05em] text-muted-foreground/50">
        <Users className="size-3.5" />
        {patients.length} patient{patients.length === 1 ? "" : "s"} found
      </div>
      {patients.map((patient) => (
        <PatientCard key={patient.uuid ?? patient.pid} patient={patient} />
      ))}
    </div>
  );
}
