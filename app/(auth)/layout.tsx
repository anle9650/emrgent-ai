import {
  ArrowLeftIcon,
  FileTextIcon,
  PillIcon,
  SearchIcon,
} from "lucide-react";
import Link from "next/link";

function EcgIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 44 18"
    >
      <polyline points="0,9 10,9 13,4 16,14 19,1 22,14 25,9 44,9" />
    </svg>
  );
}

const features = [
  {
    icon: SearchIcon,
    title: "Patient Lookup",
    description:
      "Retrieve full chart history, demographics, and active medications in seconds.",
  },
  {
    icon: FileTextIcon,
    title: "Notes & Letters",
    description:
      "Draft clinical notes, referral letters, and discharge summaries from structured context.",
  },
  {
    icon: PillIcon,
    title: "Code & Drug Lookup",
    description:
      "Resolve ICD-10 and CPT codes, check dosing, and flag interactions instantly.",
  },
];

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-dvh w-screen bg-sidebar">
      {/* Left panel — sign-in form */}
      <div className="flex w-full flex-col bg-background bg-watermark p-8 xl:w-[600px] xl:shrink-0 xl:rounded-r-2xl xl:border-r xl:border-border/40 md:p-16">
        <Link
          className="flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
          href="/"
        >
          <ArrowLeftIcon className="size-3.5" />
          Back
        </Link>

        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-10">
          <div className="flex flex-col gap-2">
            {/* ECG badge + wordmark */}
            <div className="mb-3 flex items-center gap-2.5">
              <div className="flex size-[28px] shrink-0 items-center justify-center rounded-[6px] bg-primary">
                <EcgIcon className="h-[10px] w-[18px] text-primary-foreground" />
              </div>
              <span>
                <span
                  className="font-display text-[15px] font-bold tracking-[0.07em] text-foreground"
                  style={{ fontVariant: "small-caps" }}
                >
                  EMRgent
                </span>
                <span className="ml-1.5 font-mono text-[9px] tracking-[0.1em] text-primary">
                  AI
                </span>
              </span>
            </div>

            {children}
          </div>
        </div>
      </div>

      {/* Right panel — feature showcase */}
      <div className="hidden flex-1 flex-col justify-center overflow-hidden px-16 xl:flex">
        <p className="font-display mb-10 text-[22px] leading-snug text-sidebar-foreground/70 italic">
          Clinical intelligence,
          <br />
          ready when you are.
        </p>

        <div className="flex flex-col gap-7">
          {features.map(({ icon: Icon, title, description }) => (
            <div className="flex items-start gap-4" key={title}>
              <div className="flex size-9 shrink-0 items-center justify-center rounded-[6px] bg-primary/15 text-primary ring-1 ring-primary/25">
                <Icon className="size-4" />
              </div>
              <div>
                <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-sidebar-foreground/50">
                  {title}
                </p>
                <p className="text-[13px] italic leading-relaxed text-sidebar-foreground/40">
                  {description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
