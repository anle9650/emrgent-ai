"use client";

import { Mail, User } from "lucide-react";
import { useSession } from "next-auth/react";
import type { ChatTools } from "@/lib/types";
import { MessageResponse } from "../ai-elements/message";

// Preview of a `sendMessage` call awaiting user approval. The clinician is
// reviewing exactly what will reach the patient's portal, so the whole message
// is shown inline — nothing hides behind a click. The recipient is the
// patient's first name (matching what the tool derives server-side); the
// sender isn't in the tool input (it's resolved from the session server-side),
// so read it from the client session here for the preview — the same signed-in
// user, so the two agree.
export function PendingMessageCard({
  input,
}: {
  input: ChatTools["sendMessage"]["input"];
}) {
  const { data } = useSession();
  const to = input.patient.name.split(" ")[0];
  const from = data?.user?.name ?? "Your care team";

  return (
    <div className="flex overflow-hidden rounded-xl border border-border/50 bg-card shadow-(--shadow-card)">
      <div className="w-[3px] shrink-0 self-stretch bg-primary/70" />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-border/40 border-b px-3 py-[9px] text-[12px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <User className="size-[11px] shrink-0" />
            <span className="font-mono text-[10px] text-muted-foreground/60 uppercase tracking-[0.08em]">
              To
            </span>
            <span className="truncate text-foreground/80">{to}</span>
          </span>
          <span className="flex items-center gap-1">
            <Mail className="size-[11px] shrink-0" />
            <span className="font-mono text-[10px] text-muted-foreground/60 uppercase tracking-[0.08em]">
              From
            </span>
            <span className="truncate text-foreground/80">{from}</span>
          </span>
        </div>

        <div className="flex flex-col gap-1.5 px-3 py-2.5">
          <p className="font-medium text-[13px] text-foreground leading-snug">
            {input.title}
          </p>
          <MessageResponse className="text-[12px] text-muted-foreground leading-relaxed">
            {input.body}
          </MessageResponse>
        </div>
      </div>
    </div>
  );
}
