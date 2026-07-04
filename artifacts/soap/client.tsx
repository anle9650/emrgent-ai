"use client";

import { format } from "date-fns";
import {
  CalendarClock,
  Check,
  ShieldCheck,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { Artifact } from "@/components/chat/create-artifact";
import type { SoapNote } from "@/lib/openemr/types";
import { cn, parseDateSafe } from "@/lib/utils";

/** Serialized into `UIArtifact.content` when a SOAP note card is clicked.
 * The note itself carries `pid` and `id` (the note id), but not the encounter
 * id, so the card passes `eid` alongside. */
export type SoapArtifactPayload = {
  eid: number | string;
  note: SoapNote;
};

export type SoapArtifactMetadata = {
  saveState: "saving" | "saved" | "error";
} | null;

const SECTIONS = [
  { key: "subjective", label: "Subjective", letter: "S" },
  { key: "objective", label: "Objective", letter: "O" },
  { key: "assessment", label: "Assessment", letter: "A" },
  { key: "plan", label: "Plan", letter: "P" },
] as const;

type SectionKey = (typeof SECTIONS)[number]["key"];
type Sections = Record<SectionKey, string>;

function parsePayload(content: string): SoapArtifactPayload | null {
  try {
    const parsed: unknown = JSON.parse(content);
    if (
      parsed &&
      typeof parsed === "object" &&
      "note" in parsed &&
      "eid" in parsed
    ) {
      return parsed as SoapArtifactPayload;
    }
    return null;
  } catch {
    return null;
  }
}

function pickSections(note: Partial<SoapNote>): Sections {
  return {
    subjective: note.subjective ?? "",
    objective: note.objective ?? "",
    assessment: note.assessment ?? "",
    plan: note.plan ?? "",
  };
}

// Same reasoning as encounters.tsx: the shared fetcher expects {code, cause}
// error bodies, which the openemr proxy routes don't emit.
const soapNoteFetcher = async (url: string): Promise<SoapNote | null> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`SOAP note request failed (${response.status})`);
  }
  return response.json();
};

const SAVE_DEBOUNCE_MS = 1500;

/** Floating status pill pinned to the bottom of the editor, so save feedback
 * stays visible even when the meta row is scrolled away or the panel header
 * (which shows the same state) is hidden. */
function SaveIndicator({
  saveState,
}: {
  saveState: NonNullable<SoapArtifactMetadata>["saveState"];
}) {
  return (
    <div className="pointer-events-none sticky bottom-4 z-10 flex justify-end">
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 font-semibold text-[11px] leading-none shadow-(--shadow-card) backdrop-blur-sm",
          saveState === "saved" &&
            "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
          saveState === "saving" &&
            "border-border/60 bg-card/90 text-muted-foreground",
          saveState === "error" &&
            "border-destructive/30 bg-destructive/10 text-destructive"
        )}
      >
        {saveState === "saving" && (
          <>
            <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />
            Saving…
          </>
        )}
        {saveState === "saved" && (
          <>
            <Check className="size-3 shrink-0" />
            Saved to OpenEMR
          </>
        )}
        {saveState === "error" && (
          <>
            <TriangleAlert className="size-3 shrink-0" />
            Couldn't save — retrying on next edit
          </>
        )}
      </span>
    </div>
  );
}

function SoapNoteEditor({
  payload,
  metadata,
  setMetadata,
}: {
  payload: SoapArtifactPayload;
  metadata: SoapArtifactMetadata;
  setMetadata: (metadata: SoapArtifactMetadata) => void;
}) {
  const { note, eid } = payload;
  const [sections, setSections] = useState<Sections>(() => pickSections(note));

  const latestSectionsRef = useRef(sections);
  const isDirtyRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The card snapshot in the chat can be stale (e.g. the note was already
  // edited in a previous session), so refresh from OpenEMR on open. Skipped
  // once the user starts typing.
  const { data: freshNote } = useSWR(
    `/api/openemr/soap-note?pid=${encodeURIComponent(String(note.pid))}&eid=${encodeURIComponent(String(eid))}`,
    soapNoteFetcher,
    { revalidateOnFocus: false }
  );

  useEffect(() => {
    if (freshNote && freshNote.id === note.id && !isDirtyRef.current) {
      const next = pickSections(freshNote);
      latestSectionsRef.current = next;
      setSections(next);
    }
  }, [freshNote, note.id]);

  const persist = async (next: Sections) => {
    try {
      const response = await fetch(
        `/api/openemr/soap-note?pid=${encodeURIComponent(String(note.pid))}&eid=${encodeURIComponent(String(eid))}&sid=${encodeURIComponent(String(note.id))}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        }
      );
      if (!response.ok) {
        throw new Error(`SOAP note save failed (${response.status})`);
      }
      isDirtyRef.current = false;
      setMetadata({ saveState: "saved" });
    } catch {
      setMetadata({ saveState: "error" });
      toast.error("Couldn't save the SOAP note to OpenEMR.");
    }
  };

  const handleChange = (key: SectionKey, value: string) => {
    const next = { ...latestSectionsRef.current, [key]: value };
    latestSectionsRef.current = next;
    setSections(next);
    isDirtyRef.current = true;
    setMetadata({ saveState: "saving" });

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    // Intentionally not cleared on unmount: a pending edit still saves if the
    // panel is closed mid-debounce.
    saveTimerRef.current = setTimeout(() => {
      persist(latestSectionsRef.current);
      saveTimerRef.current = null;
    }, SAVE_DEBOUNCE_MS);
  };

  const parsedDate = parseDateSafe(note.date);
  const isSigned = note.authorized === 1;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-5 py-8 md:px-8 md:py-10">
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
        <span className="inline-flex items-center gap-1 tabular-nums text-[12px] text-muted-foreground">
          <CalendarClock className="size-[11px] shrink-0" />
          {parsedDate ? format(parsedDate, "MMM d, yyyy · h:mm a") : note.date}
        </span>
        {note.user && (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/60">
            <UserRound className="size-[11px] shrink-0" />
            {note.user}
          </span>
        )}
        <span
          className={cn(
            "ms-auto inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 font-semibold text-[10px] leading-none",
            isSigned
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "bg-muted text-muted-foreground/60"
          )}
        >
          {isSigned && <ShieldCheck className="size-[10px] shrink-0" />}
          {isSigned ? "Signed" : "Unsigned"}
        </span>
      </div>

      {SECTIONS.map(({ key, label, letter }) => (
        <div className="group flex flex-col gap-1.5" key={key}>
          <label
            className="flex items-center gap-2"
            htmlFor={`soap-section-${key}`}
          >
            <span className="flex size-5 items-center justify-center rounded-md bg-primary/10 font-bold text-[10px] text-primary ring-1 ring-primary/20">
              {letter}
            </span>
            <span className="font-bold text-[10px] text-muted-foreground/50 uppercase tracking-[0.09em] transition-colors group-focus-within:text-primary">
              {label}
            </span>
          </label>
          <textarea
            className="field-sizing-content min-h-24 w-full resize-none rounded-xl border border-border/50 bg-card px-3.5 py-2.5 text-[13.5px] text-foreground leading-[1.6] shadow-(--shadow-card) outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
            id={`soap-section-${key}`}
            onChange={(event) => handleChange(key, event.target.value)}
            placeholder={`No ${label.toLowerCase()} documented.`}
            value={sections[key]}
          />
        </div>
      ))}

      {metadata?.saveState && <SaveIndicator saveState={metadata.saveState} />}
    </div>
  );
}

export const soapArtifact = new Artifact<"soap", SoapArtifactMetadata>({
  kind: "soap",
  description: "Edit a patient's SOAP note stored in OpenEMR.",
  // SOAP notes are opened from chat cards, never streamed by the model.
  onStreamPart: () => {
    // no-op
  },
  content: ({ content, metadata, setMetadata }) => {
    const payload = parsePayload(content);

    if (!payload) {
      return (
        <div className="px-8 py-10 text-muted-foreground text-sm">
          Couldn't load this SOAP note.
        </div>
      );
    }

    // Keyed so switching to a different note remounts the editor instead of
    // carrying over the previous note's local state.
    return (
      <SoapNoteEditor
        key={`${payload.note.pid}:${payload.eid}:${payload.note.id}`}
        metadata={metadata}
        payload={payload}
        setMetadata={setMetadata}
      />
    );
  },
  actions: [],
  toolbar: [],
});
