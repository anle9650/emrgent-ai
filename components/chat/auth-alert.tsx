import Link from "next/link";

/**
 * Auth failures render as an abnormal-result flag rather than a generic alert
 * box: a hairline rule in `negative`, a mono eyebrow naming the class of
 * failure the way a lab report flags a value, then the plain-language reading
 * and its recovery action. No icon — the rule and the label carry the severity.
 */
export function AuthAlert({
  label,
  children,
  action,
}: {
  /** The failure class, e.g. "Email in use". Set in mono small-caps. */
  label: string;
  /** What happened, in one sentence. */
  children: React.ReactNode;
  /** The one next step that resolves it, when there is one. */
  action?: { href: string; label: string };
}) {
  return (
    <div
      className="flex animate-in flex-col gap-1 border-negative/60 border-l-2 py-0.5 pl-3.5 duration-200 fade-in-0 slide-in-from-top-1 motion-reduce:animate-none"
      role="alert"
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-negative">
        {label}
      </p>
      <p className="wrap-anywhere text-[13px] leading-relaxed text-foreground/80">
        {children}
        {action ? (
          <>
            {" "}
            <Link
              className="text-foreground underline decoration-negative/40 underline-offset-4 transition-colors hover:decoration-negative"
              href={action.href}
            >
              {action.label}
            </Link>
          </>
        ) : null}
      </p>
    </div>
  );
}
