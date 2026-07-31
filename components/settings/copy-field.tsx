"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const COPIED_RESET_MS = 2000;

/**
 * A read-only value the user has to transcribe into OpenEMR's client
 * registration form. Showing the exact string beats describing it: the
 * redirect URI is the single value people most often get wrong here.
 *
 * `summary` stands in for values too long to read (the scope list); the copy
 * button always carries the full value.
 */
export function CopyField({
  label,
  value,
  summary,
  className,
}: {
  label: string;
  value: string;
  summary?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timeout.current) {
        clearTimeout(timeout.current);
      }
    },
    []
  );

  const handleCopy = useCallback(async () => {
    await writeToClipboard(value);
    setCopied(true);
    if (timeout.current) {
      clearTimeout(timeout.current);
    }
    timeout.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
  }, [value]);

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <span className="font-mono text-[10px] text-muted-foreground/70 uppercase tracking-[0.1em]">
        {label}
      </span>
      <div className="flex items-stretch gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-lg border border-border/50 bg-muted/50 px-3 py-2 font-mono text-[12px] text-foreground/90 no-scrollbar">
          {summary ?? value}
        </code>
        <Button
          aria-label={copied ? `${label} copied` : `Copy ${label}`}
          className="shrink-0"
          onClick={handleCopy}
          size="icon-sm"
          type="button"
          variant="outline"
        >
          {copied ? (
            <CheckIcon className="text-positive" />
          ) : (
            <CopyIcon className="text-muted-foreground" />
          )}
        </Button>
      </div>
      <output aria-live="polite" className="sr-only">
        {copied ? `${label} copied to clipboard` : ""}
      </output>
    </div>
  );
}

// navigator.clipboard is unavailable outside secure contexts — which includes
// plain-http local dev, exactly where people set this up. Fall back rather than
// silently failing.
async function writeToClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Fall through to the legacy path.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}
