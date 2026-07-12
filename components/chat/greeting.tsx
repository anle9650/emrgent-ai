import { motion } from "framer-motion";
import { EcgIcon } from "../ecg-icon";

export const Greeting = () => {
  return (
    <div className="flex flex-col items-center px-4" key="overview">
      {/* ECG ornament rule — the brand mark as a visual divider */}
      <motion.div
        animate={{ opacity: 1 }}
        className="mb-5 flex w-full max-w-xs items-center gap-3 text-primary"
        initial={{ opacity: 0 }}
        transition={{ delay: 0.2, duration: 0.7 }}
      >
        <div className="h-px flex-1 bg-gradient-to-r from-transparent to-primary/40" />
        <EcgIcon className="h-[18px] w-11 shrink-0" />
        <div className="h-px flex-1 bg-gradient-to-l from-transparent to-primary/40" />
      </motion.div>

      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="font-display text-center text-2xl font-bold tracking-[0.06em] text-foreground md:text-[28px]"
        initial={{ opacity: 0, y: 10 }}
        style={{ fontVariant: "small-caps" }}
        transition={{ delay: 0.35, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        How can I assist you today?
      </motion.div>

      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="mt-3 text-center text-sm italic text-muted-foreground/80"
        initial={{ opacity: 0, y: 10 }}
        transition={{ delay: 0.5, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        Search patients, draft notes, look up codes, or ask anything.
      </motion.div>
    </div>
  );
};
