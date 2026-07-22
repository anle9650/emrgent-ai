"use client";

import { ClipboardPlus, Hash, Stethoscope } from "lucide-react";
import type { ChatTools } from "@/lib/types";
import { MessageResponse } from "../ai-elements/message";

// Preview of a `sendReferral` call awaiting user approval. The clinician is
// reviewing exactly what will be filed as the referral transaction, so the
// referred-to provider (name + NPI + specialty + location + phone, from
// `search_individual_providers`) and the diagnosis/reason are shown inline —
// nothing hides behind a click. OpenEMR's `LBTref` transaction only persists
// the provider's NPI; the other attributes are display-only so the clinician
// reviews a human-readable provider, not a bare number. The referring
// provider's NPI is resolved server-side (left null for now), so it isn't
// shown. `riskLevel`/`referralDate` mirror the tool's server-side defaults
// when omitted.
export function PendingReferralCard({
  input,
}: {
  input: ChatTools["sendReferral"]["input"];
}) {
  const { referToProvider } = input;
  const riskLevel = input.riskLevel ?? "Low";
  const referralDate =
    input.referralDate ?? new Date().toISOString().slice(0, 10);

  const meta = [
    `NPI ${referToProvider.npi}`,
    referToProvider.specialty,
    referToProvider.location,
    referToProvider.phone,
  ].filter(Boolean);

  return (
    <div className="flex overflow-hidden rounded-xl border border-border/50 bg-card shadow-(--shadow-card)">
      <div className="w-[3px] shrink-0 self-stretch bg-encounter/70" />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-border/40 border-b px-3 py-[9px] text-[12px] text-muted-foreground">
          <span className="flex min-w-0 items-center gap-1">
            <Hash className="size-[11px] shrink-0" />
            <span className="font-mono text-[10px] text-muted-foreground/60 uppercase tracking-[0.08em]">
              Risk
            </span>
            <span className="truncate text-foreground/80">{riskLevel}</span>
          </span>
          <span className="flex min-w-0 items-center gap-1">
            <ClipboardPlus className="size-[11px] shrink-0" />
            <span className="font-mono text-[10px] text-muted-foreground/60 uppercase tracking-[0.08em]">
              Date
            </span>
            <span className="truncate text-foreground/80">{referralDate}</span>
          </span>
        </div>

        <div className="flex flex-col gap-2 px-3 py-2.5">
          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-1.5">
              <Stethoscope className="size-[13px] shrink-0 text-encounter" />
              <span className="font-medium text-[13px] text-foreground leading-snug">
                {referToProvider.name}
              </span>
            </span>
            <span className="pl-[19px] font-mono text-[10px] text-muted-foreground/70 uppercase tracking-[0.06em]">
              {meta.join(" · ")}
            </span>
          </div>

          <div className="flex flex-col gap-1.5 border-border/40 border-t pt-2">
            <p className="font-medium text-[13px] text-foreground leading-snug">
              {input.referDiagnosis}
            </p>
            <MessageResponse className="text-[12px] text-muted-foreground leading-relaxed">
              {input.reason}
            </MessageResponse>
          </div>
        </div>
      </div>
    </div>
  );
}
