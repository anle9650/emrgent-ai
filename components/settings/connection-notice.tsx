import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * The band between the panel header and step I. Whatever the state of the
 * line, it answers the same question — what do I do now? — and it sits above
 * the steps because the signed-in form is tall enough that anything below them
 * is past the fold.
 */
function NoticeBand({
  eyebrow,
  children,
  action,
}: {
  eyebrow: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <div className="flex min-w-0 flex-col gap-1">
        <h2 className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.14em]">
          {eyebrow}
        </h2>
        <p className="max-w-prose text-[13px] text-muted-foreground leading-relaxed">
          {children}
        </p>
      </div>
      {action}
    </div>
  );
}

/**
 * No line yet. Landing here straight from registration makes connecting look
 * mandatory; it isn't, so this carries the whole optionality message and the
 * header stays a plain statement of what the page is for.
 *
 * With the demo instance running, opting out is real work ("Start with demo
 * data"). Without it there's nothing to chart against, so the notice only says
 * when this can be picked up again.
 */
export function SkipConnectionNotice({ demoActive }: { demoActive: boolean }) {
  return (
    <NoticeBand
      action={
        demoActive && (
          <Button asChild variant="outline">
            <Link href="/">Start with demo data</Link>
          </Button>
        )
      }
      eyebrow="Optional"
    >
      {demoActive
        ? "EMRgent AI is already running on a demo instance: sample patients with full charts, the whole scribe flow, nothing leaving this session. Connect your own OpenEMR when you're ready for real records."
        : "Connecting can wait — these settings are in your account menu whenever you're ready."}
    </NoticeBand>
  );
}

/**
 * The line is live. Authorizing returns the user here, which is the right place
 * to confirm it worked — but the page has nothing left to ask of them, so it
 * has to hand them onward rather than leaving the Back arrow as the only way
 * out. This is the one place on the page that gets the gold primary; step II's
 * button has demoted itself to "Reauthorize" by now.
 */
export function ConnectedNotice() {
  return (
    <NoticeBand
      action={
        <Button asChild>
          <Link href="/">Start charting</Link>
        </Button>
      }
      eyebrow="Ready"
    >
      Your records are wired in. Pick a patient and record a visit, or ask about
      today&rsquo;s schedule.
    </NoticeBand>
  );
}
