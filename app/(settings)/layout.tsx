import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

// A standalone chrome for settings screens — deliberately outside the (chat)
// route group so it doesn't inherit the persistent ChatShell. No sidebar; a
// Back link returns to the app, mirroring how the (auth) pages are structured.
export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh w-full bg-background bg-watermark p-6 md:p-8">
      <Link
        className="flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        href="/"
      >
        <ArrowLeftIcon className="size-3.5" />
        Back
      </Link>
      <Suspense fallback={null}>{children}</Suspense>
    </div>
  );
}
