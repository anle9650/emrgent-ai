"use client";

import { differenceInYears, format } from "date-fns";
import { HeartPulse, Mail, Phone, TriangleAlert } from "lucide-react";
import useSWR from "swr";
import type {
  PatientOverviewResponse,
  Section,
} from "@/app/(chat)/api/openemr/patient-overview/route";
import { Appointments } from "@/components/chat/appointments";
import { Artifact } from "@/components/chat/create-artifact";
import { EmptyStateCard } from "@/components/chat/empty-state-card";
import { Encounters, EncounterVitals } from "@/components/chat/encounters";
import { MedicalIssues } from "@/components/chat/medical-issues";
import { EcgIcon } from "@/components/ecg-icon";
import {
  activeAllergyTitles,
  type MedicalIssueSummary,
  type PatientSummary,
} from "@/lib/openemr/summaries";
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

// The banner distinguishes "no allergies on file" from a failed fetch — a
// fetch failure must never masquerade as no-known-allergies.
function AllergyBannerContent({
  allergies,
}: {
  allergies: Section<MedicalIssueSummary[]> | undefined;
}) {
  if (allergies === undefined) {
    return (
      <span className="h-[17px] w-24 animate-pulse rounded-full bg-muted-foreground/10" />
    );
  }
  if ("error" in allergies) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/50">
        <TriangleAlert
          aria-hidden="true"
          className="size-[11px] shrink-0 text-attention/70"
        />
        Unavailable
      </span>
    );
  }
  const titles = activeAllergyTitles(allergies.data);
  if (titles.length === 0) {
    return (
      <span className="text-[11px] text-muted-foreground/50">
        No known allergies
      </span>
    );
  }
  return (
    <>
      {titles.map((title) => (
        <span
          className="inline-flex items-center rounded-full bg-negative/10 px-1.5 py-0.5 font-semibold text-[10px] text-negative leading-none"
          key={title}
        >
          {title}
        </span>
      ))}
    </>
  );
}

function DemographicsHeader({
  patient,
  allergies,
}: {
  patient: PatientSummary;
  /** undefined while the overview is still loading. */
  allergies?: Section<MedicalIssueSummary[]>;
}) {
  const isActive = patient.status?.toLowerCase() === "active";
  const location = [patient.city, patient.state].filter(Boolean).join(", ");
  const dob = patient.DOB ? parseDateSafe(patient.DOB) : null;
  const age = dob ? differenceInYears(new Date(), dob) : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="font-bold font-display text-[22px] text-foreground tracking-[0.02em]">
          {patient.name || "Unknown patient"}
        </h2>
        {patient.status && (
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 font-semibold text-[10px] leading-none",
              isActive
                ? "bg-positive/10 text-positive"
                : "bg-muted text-muted-foreground/60"
            )}
          >
            <span
              className={cn(
                "size-[5px] shrink-0 rounded-full",
                isActive ? "bg-positive" : "bg-muted-foreground/40"
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

      {/* Reserved height so the row doesn't shift when the fetch resolves. */}
      <div className="flex min-h-[19px] flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-mono text-[10px] text-muted-foreground/50 uppercase tracking-[0.08em]">
          Allergies
        </span>
        <AllergyBannerContent allergies={allergies} />
      </div>

      {/* ECG signature rule — stands in for the plain header divider. */}
      <div
        aria-hidden="true"
        className="mt-1 flex items-center gap-3 text-primary"
      >
        <div className="h-px w-8 shrink-0 bg-gradient-to-r from-transparent to-primary/40" />
        <EcgIcon className="h-3.5 w-9 shrink-0" />
        <div className="h-px flex-1 bg-gradient-to-l from-transparent to-primary/40" />
      </div>
    </div>
  );
}

/** Eyebrow + hairline over a tight stack of sections. Deliberately not a
 * heading: the section components' own `h3`s stay a flat outline under the
 * patient-name `h2` (they also render in chat with no group ancestor). */
function OverviewGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={label} className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground/40 uppercase tracking-[0.14em]">
          {label}
        </span>
        <div className="h-px flex-1 bg-border/60" />
      </div>
      {children}
    </section>
  );
}

// Retry revalidates the whole overview — there is no per-section refetch
// endpoint, and SWR re-renders only what changed. Intentional.
function SectionError({
  label,
  onRetry,
}: {
  label: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5 self-start rounded-xl border border-border/50 bg-card px-3 py-[11px] text-[12px] text-muted-foreground shadow-(--shadow-card)">
      <TriangleAlert
        aria-hidden="true"
        className="size-3.5 shrink-0 text-attention"
      />
      Couldn't load {label} from OpenEMR.
      {onRetry && (
        <button
          className="ml-1 cursor-pointer rounded-md px-1.5 py-1 font-medium text-[11px] text-muted-foreground/60 leading-none transition-colors hover:bg-muted hover:text-foreground"
          onClick={onRetry}
          type="button"
        >
          Retry
        </button>
      )}
    </div>
  );
}

function GroupSkeleton({ blocks }: { blocks: number }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="h-3 w-16 animate-pulse rounded bg-muted-foreground/10" />
        <div className="h-px flex-1 bg-border/40" />
      </div>
      {Array.from({ length: blocks }, (_, index) => `block-${index}`).map(
        (id) => (
          <div className="flex flex-col gap-2" key={id}>
            <div className="h-3 w-32 animate-pulse rounded bg-muted-foreground/10" />
            <div className="h-20 animate-pulse rounded-xl bg-muted-foreground/10" />
          </div>
        )
      )}
    </div>
  );
}

function LatestVitalsSection({
  vitals,
  onRetry,
}: {
  vitals: PatientOverviewResponse["vitals"];
  onRetry?: () => void;
}) {
  if ("error" in vitals) {
    return <SectionError label="vitals" onRetry={onRetry} />;
  }
  if (!vitals.data) {
    return <EmptyStateCard>No vitals on file.</EmptyStateCard>;
  }
  const parsedDate = parseDateSafe(vitals.data.date);
  return (
    <div className="flex flex-col gap-2">
      <h3 className="flex items-center gap-1.5 px-0.5 font-mono font-normal text-[10px] text-muted-foreground/50 uppercase tracking-[0.08em]">
        <HeartPulse aria-hidden="true" className="size-3.5" />
        Latest vitals
        {parsedDate && (
          <span className="tabular-nums normal-case">
            · {format(parsedDate, "MMM d, yyyy")}
          </span>
        )}
      </h3>
      <div className="flex overflow-hidden rounded-xl border border-border/50 bg-card shadow-(--shadow-card)">
        {/* Vitals carry the brand gold — rose stays with medical problems. */}
        <div className="w-[3px] shrink-0 self-stretch bg-primary/70" />
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
        <GroupSkeleton blocks={3} />
        <GroupSkeleton blocks={2} />
        <GroupSkeleton blocks={1} />
      </>
    );
  } else {
    body = (
      <>
        <OverviewGroup label="Snapshot">
          <LatestVitalsSection onRetry={() => mutate()} vitals={data.vitals} />

          {"error" in data.problems ? (
            <SectionError label="medical problems" onRetry={() => mutate()} />
          ) : (
            <MedicalIssues issues={data.problems.data} kind="problems" />
          )}

          {"error" in data.medications ? (
            <SectionError label="medications" onRetry={() => mutate()} />
          ) : (
            <MedicalIssues issues={data.medications.data} kind="medications" />
          )}
        </OverviewGroup>

        <OverviewGroup label="History">
          {"error" in data.surgeries ? (
            <SectionError label="surgeries" onRetry={() => mutate()} />
          ) : (
            <MedicalIssues issues={data.surgeries.data} kind="surgeries" />
          )}

          {"error" in data.encounters ? (
            <SectionError label="encounters" onRetry={() => mutate()} />
          ) : (
            <div className="flex flex-col gap-2">
              <Encounters
                encounters={data.encounters.data.items.map((encounter) => ({
                  ...encounter,
                  vitals: null,
                }))}
              />
              {data.encounters.data.total >
                data.encounters.data.items.length && (
                <span className="px-0.5 font-mono text-[10px] text-muted-foreground/50 uppercase tracking-[0.08em]">
                  Showing {data.encounters.data.items.length} of{" "}
                  {data.encounters.data.total} encounters
                </span>
              )}
            </div>
          )}
        </OverviewGroup>

        <OverviewGroup label="Upcoming">
          {"error" in data.appointments ? (
            <SectionError label="appointments" onRetry={() => mutate()} />
          ) : (
            <Appointments appointments={data.appointments.data} />
          )}
        </OverviewGroup>
      </>
    );
  }

  // `data.allergies ?? {error:true}` guards cached/skewed responses that
  // predate the allergies key — the banner must never shimmer forever.
  const allergies: Section<MedicalIssueSummary[]> | undefined = error
    ? { error: true }
    : data
      ? (data.allergies ?? { error: true })
      : undefined;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-5 py-8 md:px-8 md:py-10">
      <DemographicsHeader allergies={allergies} patient={patient} />
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
