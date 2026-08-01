"use client";

import { useSession } from "next-auth/react";
import type { ChatTools } from "@/lib/types";

type PrescriptionInput = ChatTools["createPrescription"]["input"];

// Preview of a `createPrescription` call awaiting user approval — the
// prescription pad the clinician signs off on, deliberately unlike the
// medication-list card (`PendingMedicationCard`): a list entry documents what
// the patient takes, this dispenses it. The prescriber is the signed-in user,
// same source the referral slip uses; OpenEMR's `provider_id` is sent null for
// now, so the name is display-only. The endpoint carries no dates, so the pad
// shows none.
export function PendingPrescriptionCard({
  input,
}: {
  input: PrescriptionInput;
}) {
  const { data } = useSession();
  const prescriber = data?.user?.name ?? "Your care team";

  return (
    <div className="flex overflow-hidden rounded-xl border border-border/50 bg-card shadow-(--shadow-card)">
      <div className="w-[3px] shrink-0 self-stretch bg-medication/70" />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start gap-x-3 px-3.5 pt-3 pb-2.5">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="font-mono text-[10px] text-medication/80 uppercase tracking-[0.14em]">
              Prescription
            </span>
            <span className="truncate font-bold font-display text-[15px] text-foreground tracking-[0.01em]">
              {input.patient.name || "Patient"}
            </span>
          </div>

          {/* The pad's signature mark — the apothecary Rx, letterpressed.
              Spelled out rather than the ℞ glyph, which Lora doesn't carry
              (it falls back to a bare "R"). */}
          <span
            aria-hidden="true"
            className="shrink-0 rounded-[5px] bg-medication/10 px-2 py-1 font-bold font-display text-[13px] text-medication leading-none ring-1 ring-medication/25"
          >
            Rx
          </span>
        </div>

        <div className="flex flex-col gap-1 border-border/40 border-t px-3.5 py-2.5">
          <span className="truncate font-medium font-display text-[15px] text-foreground leading-snug">
            {input.drug}
          </span>
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="flex items-baseline gap-1.5">
              <span className="font-mono text-[10px] text-muted-foreground/60 uppercase tracking-[0.08em]">
                Dose
              </span>
              <span className="text-[13px] text-foreground">
                {input.dosage}
              </span>
            </span>
            <span className="text-muted-foreground/40">·</span>
            <span className="flex items-baseline gap-1.5">
              <span className="font-mono text-[10px] text-muted-foreground/60 uppercase tracking-[0.08em]">
                Qty
              </span>
              <span className="text-[13px] text-foreground">
                {input.quantity}
              </span>
            </span>
          </span>
        </div>

        <div className="flex min-w-0 items-baseline gap-1.5 border-border/40 border-t px-3.5 py-2">
          <span className="font-mono text-[10px] text-muted-foreground/60 uppercase tracking-[0.08em]">
            Prescriber
          </span>
          <span className="truncate text-[12px] text-muted-foreground">
            {prescriber}
          </span>
        </div>
      </div>
    </div>
  );
}
