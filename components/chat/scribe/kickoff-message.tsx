"use client";

import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import { SCRIBE_TRANSCRIPT_MARKER } from "@/lib/ai/scribe";
import { cn } from "@/lib/utils";

// Renders a scribe kickoff message with its (potentially very long) encounter
// transcript collapsed behind a toggle, so the bubble doesn't dominate the
// thread. The header lines above the marker render as-is.
export function ScribeKickoffMessage({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const markerIndex = text.indexOf(SCRIBE_TRANSCRIPT_MARKER);
  const header = text.slice(0, markerIndex).trim();
  const transcript = text
    .slice(markerIndex + SCRIBE_TRANSCRIPT_MARKER.length)
    .trim();

  return (
    <div className="flex flex-col gap-2">
      <p className="whitespace-pre-wrap">{header}</p>
      <button
        aria-expanded={open}
        className="flex cursor-pointer items-center gap-1 font-mono text-[10px] text-muted-foreground uppercase tracking-[0.08em] transition-colors duration-150 hover:text-foreground"
        onClick={() => setOpen((prev) => !prev)}
        type="button"
      >
        <ChevronDownIcon
          className={cn(
            "size-3 transition-transform duration-150",
            open && "rotate-180"
          )}
        />
        Encounter transcript
      </button>
      {open && (
        <p className="max-h-64 overflow-y-auto whitespace-pre-wrap border-border/40 border-l-2 pl-3 text-[13px] text-muted-foreground">
          {transcript}
        </p>
      )}
    </div>
  );
}
