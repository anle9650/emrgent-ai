"use client";

import { differenceInYears, format } from "date-fns";
import { HeartPulse, Mail, Phone, TriangleAlert } from "lucide-react";
import useSWR from "swr";
import type { PatientOverviewResponse } from "@/app/(chat)/api/openemr/patient-overview/route";
import { Appointments } from "@/components/chat/appointments";
import { Artifact } from "@/components/chat/create-artifact";
import { EmptyStateCard } from "@/components/chat/empty-state-card";
import { Encounters, EncounterVitals } from "@/components/chat/encounters";
import { MedicalIssues } from "@/components/chat/medical-issues";
import type { PatientSummary } from "@/lib/openemr/summaries";
import { cn, parseDateSafe } from "@/lib/utils";

/** Serialized into `UIArtifact.content` when a patient card is clicked. The
 * snapshot renders the demographics header instantly; the chart sections are
 * always fetched fresh from OpenEMR. */
export type PatientOverviewPayload = {
  patient: PatientSummary;
};

/** The overview is read-only and keeps no panel state. Typed as an object
 * union (not bare `null`) so the metadata intersection across all artifact
 * definitions in artifact-actions.tsx doesn't collapse to `never`. */
export type PatientOverviewMetadata = Record<string, unknown> | null;

function parsePayload(content: string): PatientOverviewPayload | null {
  try {
    const parsed: unknown = JSON.parse(content);
    if (parsed && typeof parsed === "object" && "patient" in parsed) {
      return parsed as PatientOverviewPayload;
    }
    return null;
  } catch {
    return null;
  }
}

// Same reasoning as the soap artifact: the shared fetcher expects {code,
// cause} error bodies, which the openemr proxy routes don't emit. A 401 is
// surfaced distinctly so the panel can show the "connect to OpenEMR" state.
const overviewFetcher = async (
  url: string
): Promise<PatientOverviewResponse> => {
  const response = await fetch(url);
  if (response.status === 401) {
    throw new Error("not_connected");
  }
  if (!response.ok) {
    throw new Error(`Patient overview request failed (${response.status})`);
  }
  return response.json();
};

function DemographicsField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-bold text-[9px] text-muted-foreground/40 uppercase tracking-[0.09em]">
        {label}
      </span>
      <span className="tabular-nums text-[12px] text-muted-foreground">
        {value}
      </span>
    </div>
  );
}

function DemographicsHeader({ patient }: { patient: PatientSummary }) {
  const isActive = patient.status?.toLowerCase() === "active";
  const location = [patient.city, patient.state].filter(Boolean).join(", ");
  const dob = patient.DOB ? parseDateSafe(patient.DOB) : null;
  const age = dob ? differenceInYears(new Date(), dob) : null;

  return (
    <div className="flex flex-col gap-3 border-border/50 border-b pb-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="font-bold font-display text-[22px] text-foreground tracking-[0.02em]">
          {patient.name || "Unknown patient"}
        </h2>
        {patient.status && (
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 font-semibold text-[10px] leading-none",
              isActive
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "bg-muted text-muted-foreground/60"
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

      <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
        {dob && (
          <DemographicsField
            label="DOB"
            value={`${format(dob, "MMM d, yyyy")}${age === null ? "" : ` (${age})`}`}
          />
        )}
        {patient.sex && <DemographicsField label="Sex" value={patient.sex} />}
        {patient.pubpid && (
          <DemographicsField label="ID" value={patient.pubpid} />
        )}
        {location && <DemographicsField label="Location" value={location} />}
      </div>

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
  );
}

function SectionError({ label }: { label: string }) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-xl border border-border/50 bg-card px-3 py-[11px] text-[12px] text-muted-foreground shadow-(--shadow-card)">
      <TriangleAlert className="size-3.5 shrink-0 text-amber-500" />
      Couldn't load {label} from OpenEMR.
    </div>
  );
}

function SectionSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <div className="h-3 w-32 animate-pulse rounded bg-muted-foreground/10" />
      <div className="h-20 animate-pulse rounded-xl bg-muted-foreground/10" />
    </div>
  );
}

function LatestVitalsSection({
  vitals,
}: {
  vitals: PatientOverviewResponse["vitals"];
}) {
  if ("error" in vitals) {
    return <SectionError label="vitals" />;
  }
  if (!vitals.data) {
    return <EmptyStateCard>No vitals on file.</EmptyStateCard>;
  }
  const parsedDate = parseDateSafe(vitals.data.date);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 px-0.5 font-mono text-[10px] text-muted-foreground/50 uppercase tracking-[0.08em]">
        <HeartPulse className="size-3.5" />
        Latest vitals
        {parsedDate && (
          <span className="tabular-nums normal-case">
            · {format(parsedDate, "MMM d, yyyy")}
          </span>
        )}
      </div>
      <div className="flex overflow-hidden rounded-xl border border-border/50 bg-card shadow-(--shadow-card)">
        <div className="w-[3px] shrink-0 self-stretch bg-rose-500/70" />
        <div className="min-w-0 flex-1 px-3 py-[11px]">
          <EncounterVitals vitals={vitals.data.vitals} />
        </div>
      </div>
    </div>
  );
}

function PatientOverview({ patient }: { patient: PatientSummary }) {
  const { data, error, isLoading, mutate } = useSWR(
    `/api/openemr/patient-overview?uuid=${encodeURIComponent(patient.uuid)}&pid=${encodeURIComponent(String(patient.pid))}`,
    overviewFetcher,
    { revalidateOnFocus: false }
  );

  let body: React.ReactNode;
  if (error) {
    body =
      error.message === "not_connected" ? (
        <EmptyStateCard>
          Connect to OpenEMR to view this patient's chart.
        </EmptyStateCard>
      ) : (
        <div className="flex flex-col items-start gap-3">
          <EmptyStateCard>
            Couldn't load this patient's chart from OpenEMR.
          </EmptyStateCard>
          <button
            className="cursor-pointer rounded-md px-1.5 py-1 font-medium text-[11px] text-muted-foreground/60 leading-none transition-colors hover:bg-muted hover:text-foreground"
            onClick={() => mutate()}
            type="button"
          >
            Try again
          </button>
        </div>
      );
  } else if (isLoading || !data) {
    body = (
      <>
        <SectionSkeleton />
        <SectionSkeleton />
        <SectionSkeleton />
        <SectionSkeleton />
      </>
    );
  } else {
    body = (
      <>
        {"error" in data.problems ? (
          <SectionError label="medical problems" />
        ) : (
          <MedicalIssues issues={data.problems.data} kind="problems" />
        )}

        {"error" in data.medications ? (
          <SectionError label="medications" />
        ) : (
          <MedicalIssues issues={data.medications.data} kind="medications" />
        )}

        {"error" in data.surgeries ? (
          <SectionError label="surgeries" />
        ) : (
          <MedicalIssues issues={data.surgeries.data} kind="surgeries" />
        )}

        <LatestVitalsSection vitals={data.vitals} />

        {"error" in data.encounters ? (
          <SectionError label="encounters" />
        ) : (
          <div className="flex flex-col gap-2">
            <Encounters
              encounters={data.encounters.data.items.map((encounter) => ({
                ...encounter,
                vitals: null,
              }))}
            />
            {data.encounters.data.total > data.encounters.data.items.length && (
              <span className="px-0.5 font-mono text-[10px] text-muted-foreground/50 uppercase tracking-[0.08em]">
                Showing {data.encounters.data.items.length} of{" "}
                {data.encounters.data.total} encounters
              </span>
            )}
          </div>
        )}

        {"error" in data.appointments ? (
          <SectionError label="appointments" />
        ) : (
          <Appointments appointments={data.appointments.data} />
        )}
      </>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-5 py-8 md:px-8 md:py-10">
      <DemographicsHeader patient={patient} />
      {body}
    </div>
  );
}

export const patientOverviewArtifact = new Artifact<
  "patient-overview",
  PatientOverviewMetadata
>({
  kind: "patient-overview",
  description: "Read-only overview of a patient's OpenEMR chart.",
  // Opened from patient cards in chat, never streamed by the model.
  onStreamPart: () => {
    // no-op
  },
  content: ({ content }) => {
    const payload = parsePayload(content);

    if (!payload) {
      return (
        <div className="px-8 py-10 text-muted-foreground text-sm">
          Couldn't load this patient's chart.
        </div>
      );
    }

    // Keyed so switching to a different patient remounts the overview instead
    // of carrying over the previous patient's fetch state.
    return (
      <PatientOverview
        key={payload.patient.uuid ?? payload.patient.pid}
        patient={payload.patient}
      />
    );
  },
  actions: [],
  toolbar: [],
});
