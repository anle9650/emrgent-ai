"use client";

import { format } from "date-fns";
import { LoaderIcon, SearchIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { Appointments } from "@/components/chat/appointments";
import { EmptyStateCard } from "@/components/chat/empty-state-card";
import { Patients } from "@/components/chat/patients";
import { Input } from "@/components/ui/input";
import {
  type ScribeSelection,
  selectionFromAppointment,
  selectionFromPatient,
} from "@/lib/ai/scribe";
import type { PatientSummary } from "@/lib/openemr/summaries";
import type { Appointment } from "@/lib/openemr/types";

// The openemr proxy routes report errors as plain `{ error }` bodies (401
// not_connected_to_openemr / 502 openemr_api_error), not the `{code, cause}`
// shape the shared `fetcher` in lib/utils expects — so use a local one.
class ProxyError extends Error {
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.status = status;
  }
}

async function proxyFetcher<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ProxyError(body?.error ?? "request_failed", response.status);
  }
  return response.json();
}

function isNotConnected(error: unknown) {
  return error instanceof ProxyError && error.status === 401;
}

// "Jane Doe" -> one fname+lname query; a single token (2-char minimum, so a
// lone keystroke doesn't fire) searches first AND last name in parallel.
function toSearchUrls(query: string): string[] | null {
  const base = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/openemr/patients`;
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return null;
  }
  if (tokens.length === 1) {
    if (tokens[0].length < 2) {
      return null;
    }
    return [
      `${base}?${new URLSearchParams({ lname: tokens[0] })}`,
      `${base}?${new URLSearchParams({ fname: tokens[0] })}`,
    ];
  }
  return [
    `${base}?${new URLSearchParams({
      fname: tokens[0],
      lname: tokens.slice(1).join(" "),
    })}`,
  ];
}

async function searchFetcher(urls: string[]): Promise<PatientSummary[]> {
  const results = await Promise.all(
    urls.map((url) => proxyFetcher<PatientSummary[]>(url))
  );
  const seen = new Set<string>();
  const merged: PatientSummary[] = [];
  for (const patient of results.flat()) {
    const key = patient.uuid ?? String(patient.pid);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(patient);
    }
  }
  return merged;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-0.5 font-mono text-[10px] text-muted-foreground/70 uppercase tracking-[0.08em]">
      {children}
    </span>
  );
}

function NotConnectedNotice() {
  return (
    <div className="rounded-xl border border-attention/30 bg-attention/5 px-4 py-3 text-[13px] text-muted-foreground">
      Not connected to OpenEMR. Sign in with OpenEMR to browse appointments and
      patients.
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="flex flex-col gap-2">
      {[0, 1].map((row) => (
        <div
          className="h-16 animate-pulse rounded-xl border border-border/50 bg-card motion-reduce:animate-none"
          key={row}
        />
      ))}
    </div>
  );
}

export function PatientSelect({
  onSelect,
}: {
  onSelect: (selection: ScribeSelection) => void;
}) {
  const today = useMemo(() => format(new Date(), "yyyy-MM-dd"), []);

  const {
    data: appointments,
    error: appointmentsError,
    isLoading: appointmentsLoading,
  } = useSWR<Appointment[]>(
    `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/openemr/appointments?startDate=${today}&endDate=${today}`,
    proxyFetcher,
    { revalidateOnFocus: false }
  );

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timeout);
  }, [query]);

  const searchUrls = toSearchUrls(debouncedQuery);

  const {
    data: patients,
    error: patientsError,
    isLoading: patientsLoading,
  } = useSWR<PatientSummary[]>(searchUrls, searchFetcher, {
    revalidateOnFocus: false,
    keepPreviousData: true,
  });

  if (isNotConnected(appointmentsError)) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-8">
        <NotConnectedNotice />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-7 px-4 py-8">
      <header className="flex flex-col gap-1">
        <h2 className="font-display font-bold text-[19px] text-foreground tracking-[0.06em]">
          Start a scribe session
        </h2>
        <p className="text-[13px] text-muted-foreground">
          Select a patient. The recorded encounter will be charted to their
          record.
        </p>
      </header>

      <section aria-busy={patientsLoading} className="flex flex-col gap-2">
        <SectionLabel>Find a patient</SectionLabel>
        <div className="relative">
          <SearchIcon className="-translate-y-1/2 absolute top-1/2 left-3 size-3.5 text-muted-foreground/50" />
          <Input
            className="pl-8 pr-8"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name..."
            value={query}
          />
          {patientsLoading && patients && (
            <LoaderIcon className="-translate-y-1/2 absolute top-1/2 right-3 size-3.5 animate-spin text-muted-foreground/70 motion-reduce:animate-none" />
          )}
        </div>
        {isNotConnected(patientsError) && <NotConnectedNotice />}
        {patientsError && !isNotConnected(patientsError) && (
          <p className="text-[13px] text-muted-foreground">
            Patient search failed. Try again.
          </p>
        )}
        {patientsLoading && !patients && <LoadingRows />}
        {patients && searchUrls && (
          <Patients
            onSelectPatient={(patient) =>
              onSelect(selectionFromPatient(patient))
            }
            patients={patients}
          />
        )}
      </section>

      <section className="flex flex-col gap-2">
        <SectionLabel>Today&apos;s appointments</SectionLabel>
        {appointmentsLoading && <LoadingRows />}
        {appointmentsError && !appointmentsLoading && (
          <p className="text-[13px] text-muted-foreground">
            Couldn&apos;t load today&apos;s appointments from OpenEMR.
          </p>
        )}
        {appointments &&
          (appointments.length === 0 ? (
            <EmptyStateCard>
              No appointments on today&apos;s calendar — search for the patient.
            </EmptyStateCard>
          ) : (
            <Appointments
              appointments={appointments}
              hideHeader
              onSelectAppointment={(appointment) =>
                onSelect(selectionFromAppointment(appointment))
              }
            />
          ))}
      </section>
    </div>
  );
}
