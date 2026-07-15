"use client";

import { format } from "date-fns";
import { SearchIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { Appointments } from "@/components/chat/appointments";
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

// "Jane Doe" -> fname/lname; a single token searches last name.
function toNameParams(query: string): Record<string, string> | null {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return null;
  }
  if (tokens.length === 1) {
    return { lname: tokens[0] };
  }
  return { fname: tokens[0], lname: tokens.slice(1).join(" ") };
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-0.5 font-mono text-[10px] text-muted-foreground/50 uppercase tracking-[0.08em]">
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
          className="h-16 animate-pulse rounded-xl border border-border/50 bg-card"
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

  const nameParams = toNameParams(debouncedQuery);
  const searchKey = nameParams
    ? `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/openemr/patients?${new URLSearchParams(nameParams)}`
    : null;

  const {
    data: patients,
    error: patientsError,
    isLoading: patientsLoading,
  } = useSWR<PatientSummary[]>(searchKey, proxyFetcher, {
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
          Choose one of today&apos;s appointments, or search for a patient. The
          recorded encounter will be charted to their record.
        </p>
      </header>

      <section className="flex flex-col gap-2">
        {appointmentsLoading && (
          <>
            <SectionLabel>Today&apos;s appointments</SectionLabel>
            <LoadingRows />
          </>
        )}
        {appointmentsError && !appointmentsLoading && (
          <p className="text-[13px] text-muted-foreground">
            Couldn&apos;t load today&apos;s appointments from OpenEMR.
          </p>
        )}
        {appointments && (
          <Appointments
            appointments={appointments}
            onSelectAppointment={(appointment) =>
              onSelect(selectionFromAppointment(appointment))
            }
          />
        )}
      </section>

      <section className="flex flex-col gap-2">
        <SectionLabel>Find a patient</SectionLabel>
        <div className="relative">
          <SearchIcon className="-translate-y-1/2 absolute top-1/2 left-3 size-3.5 text-muted-foreground/50" />
          <Input
            className="pl-8"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Last name, or “First Last”"
            value={query}
          />
        </div>
        {isNotConnected(patientsError) && <NotConnectedNotice />}
        {patientsError && !isNotConnected(patientsError) && (
          <p className="text-[13px] text-muted-foreground">
            Patient search failed. Try again.
          </p>
        )}
        {patientsLoading && !patients && <LoadingRows />}
        {patients && nameParams && (
          <Patients
            onSelectPatient={(patient) =>
              onSelect(selectionFromPatient(patient))
            }
            patients={patients}
          />
        )}
      </section>
    </div>
  );
}
