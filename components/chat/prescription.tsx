"use client";

import { useSession } from "next-auth/react";
import type { ChatTools } from "@/lib/types";

type PrescriptionInput = ChatTools["createPrescription"]["input"];

// `quantity` is free text from the model — "30", "#30", "30 tablets" all show
// up. The pad prints the pharmacy convention (`Disp. #30`), so the "#" is
// supplied here and stripped from the value to avoid "##30".
function dispenseQuantity(quantity: string) {
  return quantity.trim().replace(/^#\s*/, "");
}

// Preview of a `createPrescription` call awaiting user approval.
//
// This runs in the same approval wave as `PendingMedicationCard` — starting a
// patient on a new drug charts it *and* dispenses it — so the two cards are
// read side by side and must not be confused. They share the medication hue
// (same drug, same domain) and differ by material instead: the medication card
// is a ledger row, this is a sheet torn off a pad. Security-paper ground,
// perforated tear at the masthead, the drug set as an inscription with its Sig
// line beneath, and a signature rule the prescriber's name sits on.
//
// The prescriber is the signed-in user, same source the referral slip uses;
// OpenEMR's `provider_id` is sent null for now, so the name is display-only.
// The endpoint carries no dates, so the pad shows none.
export function PendingPrescriptionCard({
  input,
}: {
  input: PrescriptionInput;
}) {
  const { data } = useSession();
  const prescriber = data?.user?.name ?? "Your care team";
  const sig = input.dosage?.trim();
  const quantity = dispenseQuantity(input.quantity ?? "");

  return (
    <div className="flex overflow-hidden rounded-xl border border-border/50 bg-card shadow-(--shadow-card)">
      <div className="w-[3px] shrink-0 self-stretch bg-medication/70" />

      <div className="relative isolate flex min-w-0 flex-1 flex-col">
        {/* The pad's stock. Behind everything, never under the text's contrast. */}
        <div
          aria-hidden="true"
          className="-z-10 absolute inset-0 bg-rx-paper opacity-[0.045] dark:opacity-[0.07]"
        />

        <div className="flex items-start gap-x-3 px-3.5 pt-3 pb-2.5">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="font-mono text-[10px] text-medication/80 uppercase tracking-[0.14em]">
              Prescription
            </span>
            <span className="truncate font-bold font-display text-[15px] text-foreground tracking-[0.01em]">
              {input.patient.name || "Patient"}
            </span>
          </div>

          {/* The pad's signature mark — the apothecary Rx, letterpressed bare.
              Spelled out rather than the ℞ glyph, which Lora doesn't carry
              (it falls back to a bare "R"). */}
          <span
            aria-hidden="true"
            className="shrink-0 font-bold font-display text-[17px] text-medication leading-none tracking-[0.02em]"
          >
            Rx
          </span>
        </div>

        {/* The perforation: where the sheet leaves the pad. Every other card in
            the app divides with a solid rule — this one tears. */}
        <div className="flex flex-col gap-1 border-border/70 border-t border-dashed px-3.5 pt-3 pb-2.5 dark:border-border">
          {/* Never truncated: on a prescription the drug is the one field that
              has to be legible in full, however long the name runs. */}
          <span className="font-display text-[17px] text-foreground leading-snug">
            {input.drug}
          </span>
          {sig && (
            <span className="font-display text-[15px] text-muted-foreground leading-snug">
              Sig. {sig}
            </span>
          )}
          {quantity && (
            <span className="pt-1 font-mono text-[11px] text-muted-foreground/70 uppercase tabular-nums tracking-[0.08em]">
              Disp. #{quantity}
            </span>
          )}
        </div>

        {/* The signature block: name on the rule, label printed beneath it. */}
        <div className="mx-3.5 flex min-w-0 flex-col gap-0.5 border-border border-t pt-2 pb-2.5">
          <span className="truncate text-[13px] text-foreground">
            {prescriber}
          </span>
          <span className="font-mono text-[10px] text-muted-foreground/60 uppercase tracking-[0.08em]">
            Prescriber
          </span>
        </div>
      </div>
    </div>
  );
}
