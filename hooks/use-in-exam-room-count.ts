"use client";

import useSWR from "swr";
import { countInExamRoom } from "@/lib/openemr/appointment-status";
import { proxyFetcher } from "@/lib/openemr/proxy-fetch";
import type { Appointment } from "@/lib/openemr/types";
import { localToday } from "@/lib/utils";

// The roster turns over during a clinic day, so poll rather than waiting for a
// focus event. Only runs while enabled (scribe mode, no live recording).
const REFRESH_INTERVAL_MS = 60_000;

/**
 * How many of today's appointments are roomed and waiting to be seen.
 *
 * The SWR key is byte-identical to the one in `components/chat/scribe/
 * patient-select.tsx` on purpose — the two hooks then share a single cache
 * entry, so opening the patient picker doesn't refetch what the sidebar
 * already has. Errors (401 not connected / 502) fall through to 0, leaving
 * the caller with nothing to render.
 */
export function useInExamRoomCount(enabled: boolean): number {
  const today = localToday();
  const { data } = useSWR<Appointment[]>(
    enabled
      ? `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/openemr/appointments?startDate=${today}&endDate=${today}`
      : null,
    proxyFetcher,
    { revalidateOnFocus: true, refreshInterval: REFRESH_INTERVAL_MS }
  );

  return countInExamRoom(data);
}
