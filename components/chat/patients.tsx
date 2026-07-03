"use client";

import { format, parseISO } from "date-fns";
import { Cake, Mail, MapPin, Phone, User, Users } from "lucide-react";
import type { PatientSummary } from "@/lib/ai/tools/patient";
import { cn } from "@/lib/utils";

function formatDOB(dob: string) {
  try {
    return format(parseISO(dob), "MMM d, yyyy");
  } catch {
    return dob;
  }
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

function StatusBadge({ status }: { status: string }) {
  const isActive = status?.toLowerCase() === "active";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-[11px]",
        isActive
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "bg-muted text-muted-foreground"
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          isActive ? "bg-emerald-500" : "bg-muted-foreground/50"
        )}
      />
      {status || "Unknown"}
    </span>
  );
}

function MetaItem({
  icon: Icon,
  children,
  className,
}: {
  icon: typeof User;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <Icon className="size-3 shrink-0 text-muted-foreground/70" />
      {children}
    </span>
  );
}

function PatientCard({ patient }: { patient: PatientSummary }) {
  const location = [patient.city, patient.state].filter(Boolean).join(", ");

  return (
    <div className="flex items-start gap-3 rounded-xl border border-border/50 bg-card px-3.5 py-3 shadow-(--shadow-card) transition-colors hover:border-border">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted font-medium text-muted-foreground text-xs ring-1 ring-border/50">
        {initials(patient.name)}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-medium text-[13px] text-foreground">
            {patient.name || "Unknown patient"}
          </span>
          {patient.status && <StatusBadge status={patient.status} />}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-muted-foreground">
          {patient.DOB && <MetaItem icon={Cake}>{formatDOB(patient.DOB)}</MetaItem>}
          {patient.sex && <MetaItem icon={User}>{patient.sex}</MetaItem>}
          {location && <MetaItem icon={MapPin}>{location}</MetaItem>}
        </div>
        {(patient.phone || patient.email) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-muted-foreground">
            {patient.phone && (
              <MetaItem icon={Phone}>{patient.phone}</MetaItem>
            )}
            {patient.email && (
              <MetaItem className="min-w-0" icon={Mail}>
                <span className="truncate">{patient.email}</span>
              </MetaItem>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function Patients({ patients }: { patients: PatientSummary[] }) {
  if (patients.length === 0) {
    return (
      <div className="rounded-xl border border-border/50 bg-card px-3.5 py-3 text-[13px] text-muted-foreground">
        No patients found.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 px-0.5 font-medium text-[12px] text-muted-foreground">
        <Users className="size-3.5" />
        {patients.length} patient{patients.length === 1 ? "" : "s"} found
      </div>
      {patients.map((patient) => (
        <PatientCard key={patient.uuid ?? patient.pid} patient={patient} />
      ))}
    </div>
  );
}
