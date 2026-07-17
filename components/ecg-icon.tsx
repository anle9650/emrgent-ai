const ECG_POINTS = "0,9 10,9 13,4 16,14 19,1 22,14 25,9 44,9";

const FLATLINE_POINTS = "0,9 44,9";

// The brand beat trailing off into a long baseline — a monitor gone quiet.
// A bare flat line reads as a divider; the beat makes it legibly an ECG.
const SETTLED_POINTS = "0,9 10,9 13,4 16,14 19,1 22,14 25,9 72,9";

/** ECG waveform — the EMRgent brand mark. No hooks, so it renders in both
 * server and client components. `animated` draws a repeating trace over a
 * dimmed baseline (used by the assistant avatar while streaming). `flat`
 * draws a bare flatline (the recording trace at rest); `settled` draws one
 * beat settling into a long baseline (an empty schedule). Size settled
 * renders at a 72:18 ratio (e.g. `w-18`), the others at 44:18 (`w-11`). */
export function EcgIcon({
  animated = false,
  flat = false,
  settled = false,
  className,
}: {
  animated?: boolean;
  flat?: boolean;
  settled?: boolean;
  className?: string;
}) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox={settled ? "0 0 72 18" : "0 0 44 18"}
    >
      {flat ? (
        <polyline points={FLATLINE_POINTS} />
      ) : settled ? (
        <polyline points={SETTLED_POINTS} />
      ) : animated ? (
        <>
          <polyline className="opacity-30" points={ECG_POINTS} />
          <polyline
            className="animate-[ecg-trace_1.4s_linear_infinite] [stroke-dasharray:100] motion-reduce:animate-none"
            pathLength={100}
            points={ECG_POINTS}
          />
        </>
      ) : (
        <polyline points={ECG_POINTS} />
      )}
    </svg>
  );
}
