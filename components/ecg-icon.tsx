const ECG_POINTS = "0,9 10,9 13,4 16,14 19,1 22,14 25,9 44,9";

/** ECG waveform — the EMRgent brand mark. No hooks, so it renders in both
 * server and client components. `animated` draws a repeating trace over a
 * dimmed baseline (used by the assistant avatar while streaming). */
export function EcgIcon({
  animated = false,
  className,
}: {
  animated?: boolean;
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
      viewBox="0 0 44 18"
    >
      {animated ? (
        <>
          <polyline className="opacity-30" points={ECG_POINTS} />
          <polyline
            className="animate-[ecg-trace_1.4s_linear_infinite] [stroke-dasharray:100]"
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
