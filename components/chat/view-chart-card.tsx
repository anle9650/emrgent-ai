"use client";

import { ClipboardCheckIcon, FolderOpenIcon } from "lucide-react";
import type { MouseEvent } from "react";
import {
  patientOverviewArtifact,
  toSparsePatientSummary,
} from "@/components/chat/patient-overview-artifact";
import { useArtifact } from "@/hooks/use-artifact";
import type { ScribeChartWrites } from "@/lib/ai/scribe";

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
}: {
  patient: { uuid: string; pid: number; name: string };
  writes?: ScribeChartWrites;
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
