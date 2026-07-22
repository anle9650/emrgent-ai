"use client";

import { Check, CornerDownRight, Stethoscope } from "lucide-react";
import { useSession } from "next-auth/react";
import type { ChatTools } from "@/lib/types";
import { MessageResponse } from "../ai-elements/message";

type ReferralInput = ChatTools["sendReferral"]["input"];
type ReferralResults = Extract<
  ChatTools["sendReferral"]["output"],
  { results: unknown }
>["results"];
type ReferralProvider = ReferralInput["referToProvider"];
type PatientRef = ReferralInput["patient"];
type RiskLevel = NonNullable<ReferralInput["riskLevel"]>;

// Risk is real triage data, so it earns a hue — borrowed from the shared
// status tones rather than a new token. The level always prints as text too,
// so urgency is never carried by color alone.
const RISK_TONE: Record<
  RiskLevel,
  { text: string; ring: string; bg: string; dot: string }
> = {
  Low: {
    text: "text-positive",
    ring: "ring-positive/35",
    bg: "bg-positive/10",
    dot: "bg-positive",
  },
  Medium: {
    text: "text-attention",
    ring: "ring-attention/35",
    bg: "bg-attention/10",
    dot: "bg-attention",
  },
  High: {
    text: "text-negative",
    ring: "ring-negative/40",
    bg: "bg-negative/10",
    dot: "bg-negative",
  },
};

// The signature element: a letterpress-style triage stamp on the consult-slip
// masthead. The one place this card raises its voice — everything else stays
// quiet plum.
function ReferralTriageStamp({ riskLevel }: { riskLevel: RiskLevel }) {
  const tone = RISK_TONE[riskLevel];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-[5px] px-2 py-1 font-mono text-[10px] uppercase leading-none tracking-[0.1em] ring-1 ${tone.bg} ${tone.text} ${tone.ring}`}
    >
      <span className={`size-1.5 rounded-full ${tone.dot}`} />
      {riskLevel} risk
    </span>
  );
}

function providerMeta(provider: ReferralProvider) {
  return [
    `NPI ${provider.npi}`,
    provider.specialty,
    provider.location,
    provider.phone,
  ].filter(Boolean);
}

// Preview of a `sendReferral` call awaiting user approval — the consult slip
// the clinician signs off on. The masthead names all three parties of the
// hand-off: the patient (subject), the referring clinician (`from`, the
// signed-in user — same source `sendMessage`'s card uses; the server-side
// `referByNpi` stays null), and the specialist being asked (the emphasized
// destination). OpenEMR's `LBTref` transaction only persists the provider's
// NPI; the other attributes are display-only so the clinician reviews a
// human-readable provider, not a bare number. `riskLevel`/`referralDate`
// mirror the tool's server-side defaults when omitted.
export function PendingReferralCard({ input }: { input: ReferralInput }) {
  const { data } = useSession();
  const { referToProvider, patient } = input;
  const from = data?.user?.name ?? "Your care team";
  const riskLevel = input.riskLevel ?? "Low";
  const referralDate =
    input.referralDate ?? new Date().toISOString().slice(0, 10);

  return (
    <div className="flex overflow-hidden rounded-xl border border-border/50 bg-card shadow-(--shadow-card)">
      <div className="w-[3px] shrink-0 self-stretch bg-referral/70" />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start gap-x-3 px-3.5 pt-3 pb-2.5">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="font-mono text-[10px] text-referral/80 uppercase tracking-[0.14em]">
                Referral
              </span>
              <span className="truncate font-bold font-display text-[15px] text-foreground tracking-[0.01em]">
                {patient.name || "Patient"}
              </span>
            </div>

            <div className="flex min-w-0 flex-col gap-1">
              <span className="flex min-w-0 items-baseline gap-1.5 pl-[1px] text-[12px]">
                <span className="font-mono text-[10px] text-muted-foreground/60 uppercase tracking-[0.08em]">
                  From
                </span>
                <span className="truncate text-muted-foreground">{from}</span>
              </span>
              <span className="flex min-w-0 items-start gap-1.5">
                <CornerDownRight className="mt-[3px] size-[13px] shrink-0 text-referral/70" />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Stethoscope className="size-[13px] shrink-0 text-referral" />
                    <span className="truncate font-medium text-[13px] text-foreground leading-snug">
                      {referToProvider.name}
                    </span>
                  </span>
                  <span className="pl-[21px] font-mono text-[10px] text-muted-foreground/70 uppercase tracking-[0.06em]">
                    {providerMeta(referToProvider).join(" · ")}
                  </span>
                </span>
              </span>
            </div>
          </div>

          <ReferralTriageStamp riskLevel={riskLevel} />
        </div>

        <div className="flex flex-col gap-1.5 border-border/40 border-t px-3.5 py-2.5">
          <p className="flex items-baseline gap-1.5 font-medium text-[13px] text-foreground leading-snug">
            <span className="font-mono text-[10px] text-muted-foreground/60 uppercase tracking-[0.08em]">
              Dx
            </span>
            {input.referDiagnosis}
          </p>
          <MessageResponse className="text-[12px] text-muted-foreground leading-relaxed">
            {input.reason}
          </MessageResponse>
        </div>

        <div className="flex flex-wrap items-center gap-x-2 border-border/40 border-t px-3.5 py-2 font-mono text-[10px] text-muted-foreground/70 uppercase tracking-[0.08em]">
          <span>Referral date {referralDate}</span>
          <span className="text-muted-foreground/40">·</span>
          <span>Vitals attached</span>
        </div>
      </div>
    </div>
  );
}

// The filed receipt: the domain card the model renders after a `sendReferral`
// is approved and filed (mirrors how `ViewChartCard` follows `createEncounter`).
// Compact by design — one line tells the whole hand-off (patient → specialist),
// so a multi-referral visit stacks cleanly. `patient` comes from the tool
// *input*; the rest from its output (`riskLevel`/`referralDate` are always
// resolved server-side by the time it's filed).
export function FiledReferralCard({
  patient,
  results,
}: {
  patient: PatientRef;
  results: ReferralResults;
}) {
  const { referToProvider } = results;
  const specialty = referToProvider.specialty;

  return (
    <div className="flex overflow-hidden rounded-xl border border-border/50 bg-card shadow-(--shadow-card)">
      <div className="w-[3px] shrink-0 self-stretch bg-referral/70" />

      <div className="flex min-w-0 flex-1 flex-col gap-1.5 px-3.5 py-3">
        <div className="flex items-center gap-x-3">
          <span className="flex min-w-0 flex-1 items-center gap-1.5 font-mono text-[10px] text-referral/80 uppercase tracking-[0.14em]">
            <Check className="size-[13px] shrink-0 text-positive" />
            Referral filed
          </span>
          <ReferralTriageStamp riskLevel={results.riskLevel} />
        </div>

        <p className="flex flex-wrap items-center gap-x-1.5 text-[13px] leading-snug">
          <span className="font-medium text-foreground">
            {patient.name || "Patient"}
          </span>
          <CornerDownRight className="size-[12px] shrink-0 text-referral/70" />
          <Stethoscope className="size-[13px] shrink-0 text-referral" />
          <span className="font-medium text-foreground">
            {referToProvider.name}
          </span>
        </p>

        <p className="text-[12px] text-muted-foreground leading-snug">
          {[specialty, results.referDiagnosis].filter(Boolean).join(" · ")}
        </p>

        <div className="flex flex-wrap items-center gap-x-2 font-mono text-[10px] text-muted-foreground/70 uppercase tracking-[0.08em]">
          <span>Filed {results.referralDate}</span>
          <span className="text-muted-foreground/40">·</span>
          <span>Vitals attached</span>
        </div>
      </div>
    </div>
  );
}
