import type { ReactNode } from "react";

/** Shared empty-result card for the patient/encounter/note tool UIs. */
export function EmptyStateCard({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border/50 bg-card px-3.5 py-3 text-[13px] text-muted-foreground shadow-(--shadow-card)">
      {children}
    </div>
  );
}
