"use client";

import { FolderOpenIcon } from "lucide-react";
import type { MouseEvent } from "react";
import {
  patientOverviewArtifact,
  toSparsePatientSummary,
} from "@/components/chat/patient-overview-artifact";
import { useArtifact } from "@/hooks/use-artifact";

// The post-charting affordance: once a scribe visit is filed, the model emits
// this card so the clinician can open the patient's full chart overview on
// demand (we no longer force it open). The overview is fetched fresh from the
// uuid/pid, so a sparse patient ref is all we need.
export function ViewChartCard({
  patient,
}: {
  patient: { uuid: string; pid: number; name: string };
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

  return (
    <div className="w-full overflow-hidden rounded-xl border border-border/50 bg-card shadow-(--shadow-card)">
      <div className="flex">
        {/* Gold accent bar — scribe/chart surfaces carry the primary tone */}
        <div className="w-[3px] shrink-0 self-stretch bg-primary/70" />

        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-[6px] bg-primary/10 text-primary">
            <FolderOpenIcon className="size-4" />
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
            aria-label={`View full chart for ${patient.name || "patient"}`}
            className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border/50 px-2 py-1 font-mono text-[10px] text-muted-foreground/70 uppercase tracking-[0.08em] transition-colors duration-150 hover:bg-muted/40 hover:text-foreground"
            onClick={openChart}
            type="button"
          >
            <FolderOpenIcon className="size-3" />
            View chart
          </button>
        </div>
      </div>
    </div>
  );
}
