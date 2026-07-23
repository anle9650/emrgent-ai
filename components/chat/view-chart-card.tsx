"use client";

import {
  ClipboardCheckIcon,
  FolderOpenIcon,
  LoaderIcon,
  LogOutIcon,
} from "lucide-react";
import { type MouseEvent, useState } from "react";
import useSWR from "swr";
import {
  patientOverviewArtifact,
  toSparsePatientSummary,
} from "@/components/chat/patient-overview-artifact";
import { useArtifact } from "@/hooks/use-artifact";
import type { ScribeChartWrites } from "@/lib/ai/scribe";
import type { Appointment } from "@/lib/openemr/types";

// OpenEMR appointment status ">" = "Checked out" (see APPOINTMENT_STATUSES in
// components/chat/appointments.tsx).
const CHECKED_OUT = ">";

const APPOINTMENTS_URL = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/openemr/appointments`;
const CHECKOUT_URL = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/openemr/appointment-checkout`;

// The openemr proxy routes report errors as plain `{ error }` bodies, not the
// `{code, cause}` shape the shared `fetcher` expects — use a local fetcher.
async function appointmentsFetcher(url: string): Promise<Appointment[]> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("request_failed");
  }
  return response.json();
}

const countLabel = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

// The receipt line: what this session actually wrote (counts are tallied
// client-side from the tool parts — no model-transcribed values). Kept fully
// muted: the header already carries the card's two accents (positive status,
// primary action), so the tally stays quiet.
function receiptSegments(writes: ScribeChartWrites) {
  const segments: string[] = [];
  if (writes.problems > 0) {
    segments.push(countLabel(writes.problems, "problem"));
  }
  if (writes.medications > 0) {
    segments.push(countLabel(writes.medications, "medication"));
  }
  if (writes.surgeries > 0) {
    segments.push(countLabel(writes.surgeries, "surgery"));
  }
  if (writes.encounterFiled) {
    segments.push("SOAP note filed");
  }
  return segments;
}

// The Check Out action: flips the session's linked appointment to "Checked
// out". Rendered only when this session is linked to an appointment. The
// checked-out state is derived from a LIVE calendar read (not local button
// state), so it survives a chat refresh — the "eid absent" case is what our
// recreate-then-delete checkout leaves behind. While the read is loading (or on
// error), nothing renders: no wrong-state flash, and no action we can't verify.
function CheckOutButton({ pid, eid }: { pid: number; eid: string }) {
  const { data, error, isLoading, mutate } = useSWR(
    APPOINTMENTS_URL,
    appointmentsFetcher
  );
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  // Not yet knowable → render nothing rather than guess a state.
  if (isLoading || error || !data) {
    return null;
  }

  const appointment = data.find((row) => row.pc_eid === eid);
  // Original gone (our checkout deletes it) or already ">" → checked out.
  const alreadyCheckedOut =
    !appointment || appointment.pc_apptstatus === CHECKED_OUT;

  if (alreadyCheckedOut) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-positive/40 bg-positive/10 px-2 py-1 font-mono text-[10px] text-positive uppercase tracking-[0.08em]">
        <ClipboardCheckIcon className="size-3" />
        Checked out
      </span>
    );
  }

  const checkOut = async () => {
    setPending(true);
    setFailed(false);
    try {
      const response = await fetch(CHECKOUT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pid, eid }),
      });
      if (!response.ok) {
        throw new Error("checkout_failed");
      }
      // Re-read the calendar so the card settles into "Checked out" through the
      // same live source a refresh would use — one source of truth for both.
      await mutate();
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <button
      aria-label="Check out appointment"
      className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border/50 px-2 py-1 font-mono text-[10px] text-muted-foreground uppercase tracking-[0.08em] transition-colors duration-150 hover:bg-muted/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
      disabled={pending}
      onClick={checkOut}
      type="button"
    >
      {pending ? (
        <LoaderIcon className="size-3 animate-spin" />
      ) : (
        <LogOutIcon className="size-3" />
      )}
      {failed ? "Retry check out" : "Check out"}
    </button>
  );
}

// The post-charting affordance: once a scribe visit is filed, the model emits
// this card so the clinician can open the patient's full chart overview on
// demand (we no longer force it open). The overview is fetched fresh from the
// uuid/pid, so a sparse patient ref is all we need. Visually it closes the
// arc the kickoff banner opens ("Filed for charting" → "Visit charted") while
// staying in the kickoff's gold single-accent family — the check in the icon
// carries the completion state, and only the filled action button steps up.
export function ViewChartCard({
  patient,
  writes,
  appointmentEid,
}: {
  patient: { uuid: string; pid: number; name: string };
  writes?: ScribeChartWrites;
  /** The scribe session's linked appointment id, when started from an
   * appointment — enables the Check Out action. */
  appointmentEid?: string;
}) {
  const { setArtifact } = useArtifact();

  const openChart = (event: MouseEvent<HTMLButtonElement>) => {
    setArtifact(
      patientOverviewArtifact(
        toSparsePatientSummary(patient),
        event.currentTarget.getBoundingClientRect()
      )
    );
  };

  const segments = writes ? receiptSegments(writes) : [];

  return (
    <div className="w-full overflow-hidden rounded-xl border border-border/50 bg-card shadow-(--shadow-card)">
      <div className="flex">
        {/* Gold accent bar — scribe/chart surfaces carry the primary tone */}
        <div className="w-[3px] shrink-0 self-stretch bg-primary/70" />

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-[6px] bg-primary/10 text-primary">
              <ClipboardCheckIcon className="size-4" />
            </div>

            <div className="flex min-w-0 flex-col me-auto">
              <span className="font-mono text-[10px] text-muted-foreground/70 uppercase tracking-[0.1em]">
                Visit charted
              </span>
              <span className="truncate font-display font-bold text-[15px] text-foreground tracking-[0.01em]">
                {patient.name || "Patient"}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {appointmentEid && (
                <CheckOutButton eid={appointmentEid} pid={patient.pid} />
              )}
              <button
                aria-label={`View chart for ${patient.name || "patient"}`}
                className="inline-flex cursor-pointer items-center gap-1 rounded-md bg-primary px-2 py-1 font-mono text-[10px] text-primary-foreground uppercase tracking-[0.08em] transition-colors duration-150 hover:bg-primary/90"
                onClick={openChart}
                type="button"
              >
                <FolderOpenIcon className="size-3" />
                View chart
              </button>
            </div>
          </div>

          {segments.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-border/40 border-t px-4 py-2 font-mono text-[10px] text-muted-foreground/70 uppercase tracking-[0.08em]">
              {segments.map((segment, index) => (
                <span
                  className="inline-flex items-center gap-x-2"
                  key={segment}
                >
                  {index > 0 && (
                    <span className="text-muted-foreground/40">·</span>
                  )}
                  <span>{segment}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
