"use client";

import { motion } from "framer-motion";
import { MicIcon } from "lucide-react";
import { memo } from "react";
import { useScribeMode } from "@/hooks/use-scribe-mode";
import { EcgIcon } from "../ecg-icon";

function PureStartScribeCard() {
  const { returnToScribeSession } = useScribeMode();

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="w-full"
      exit={{ opacity: 0, y: 16 }}
      initial={{ opacity: 0, y: 16 }}
      transition={{ delay: 0.06, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
      <button
        className="group flex w-full items-center gap-4 rounded-xl border border-border/50 bg-card/30 px-4 py-3.5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:bg-card/60 hover:shadow-[var(--shadow-card)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:px-5"
        data-testid="start-scribe-session"
        onClick={returnToScribeSession}
        type="button"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[6px] bg-primary/12 text-primary ring-1 ring-primary/25 transition-colors duration-200 group-hover:bg-primary/20">
          <MicIcon className="size-[17px]" />
        </span>

        <span className="min-w-0 flex-1">
          <span className="block font-display text-[15px] font-bold tracking-[0.04em] text-foreground">
            Start a scribe session
          </span>
          <span className="mt-0.5 block text-[12.5px] leading-relaxed text-muted-foreground">
            Record the visit. I&rsquo;ll draft the chart, and you approve every
            entry.
          </span>
        </span>

        {/* The monitor starts running on hover: a resting brand ECG that
            traces itself when the button is engaged. */}
        <span className="relative hidden h-[18px] w-11 shrink-0 text-primary/50 transition-colors duration-200 group-hover:text-primary sm:block">
          <EcgIcon className="absolute inset-0 h-[18px] w-11 opacity-70 transition-opacity duration-200 group-hover:opacity-0 group-focus-visible:opacity-0" />
          <EcgIcon
            animated
            className="absolute inset-0 h-[18px] w-11 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100"
          />
        </span>
      </button>
    </motion.div>
  );
}

export const StartScribeCard = memo(PureStartScribeCard);
