import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Sits between the panel header and step I, while there's no live line.
 *
 * Landing here straight from registration makes connecting look mandatory; it
 * isn't. The correction has to arrive before the three numbered steps do —
 * below them it's past the fold on the signed-in form — so this reads first,
 * and it carries the whole optionality message so the header can stay a plain
 * statement of what the page is for.
 *
 * With the demo instance running, opting out is real work ("Start with demo
 * data"). Without it there's nothing to chart against, so the notice only says
 * when this can be picked up again.
 */
export function SkipConnectionNotice({ demoActive }: { demoActive: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <div className="flex min-w-0 flex-col gap-1">
        <h2 className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.14em]">
          Optional
        </h2>
        <p className="max-w-prose text-[13px] text-muted-foreground leading-relaxed">
          {demoActive
            ? "EMRgent AI is already running on a demo instance: sample patients with full charts, the whole scribe flow, nothing leaving this session. Connect your own OpenEMR when you're ready for real records."
            : "Connecting can wait — these settings are in your account menu whenever you're ready."}
        </p>
      </div>
      {demoActive && (
        <Button asChild variant="outline">
          <Link href="/">Start with demo data</Link>
        </Button>
      )}
    </div>
  );
}
