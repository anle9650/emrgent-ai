import { AsyncLocalStorage } from "node:async_hooks";

// The browser publishes its IANA timezone in this cookie (set by an inline
// script in app/layout.tsx). The server reads it to compute every viewer-facing
// "today", so the demo's always-on daily schedule lands on the viewer's calendar
// day rather than the server's — on Vercel the runtime is UTC, which is a day
// ahead of any Western-hemisphere viewer during their evening.
export const VIEWER_TZ_COOKIE = "demo_tz";

// Carries the viewer timezone into synchronous code that can't await a cookie
// read — notably the demo schedule stamp deep inside the fixture resolver. Set
// once at the openemrRequest demo branch (lib/openemr/api.ts).
const viewerTimeZoneStore = new AsyncLocalStorage<string>();

/** Run `fn` with `tz` as the ambient viewer timezone (no-op when `tz` unset). */
export function runWithViewerTimeZone<T>(
  tz: string | undefined,
  fn: () => T
): T {
  return tz ? viewerTimeZoneStore.run(tz, fn) : fn();
}

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * The calendar date `days` from now (YYYY-MM-DD) in `tz`. Gets today's
 * wall-calendar date in the zone, then shifts by whole days in UTC so month/year
 * rollover is handled without any DST time-of-day drift. A missing or invalid
 * `tz` falls back to the server's local date, preserving pre-cookie behavior for
 * dev, unit tests, and evals.
 */
export function computeLocalDate(tz: string | undefined, days = 0): string {
  if (tz) {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(new Date());
      const part = (type: string) =>
        Number(parts.find((p) => p.type === type)?.value);
      const shifted = new Date(
        Date.UTC(part("year"), part("month") - 1, part("day") + days)
      );
      return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
    } catch {
      // Invalid timezone name — fall through to server-local.
    }
  }
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Sync viewer "today" from the ALS. For code that can't await a cookie read. */
export function viewerLocalDate(days = 0): string {
  return computeLocalDate(viewerTimeZoneStore.getStore(), days);
}

/**
 * Read the viewer timezone from the request cookie. Returns undefined outside a
 * request scope (eval/test) or when unset, so callers fall back to server-local.
 * next/headers is imported lazily so this module stays importable under tsx.
 */
export async function readViewerTimeZone(): Promise<string | undefined> {
  try {
    const { cookies } = await import("next/headers");
    return (await cookies()).get(VIEWER_TZ_COOKIE)?.value || undefined;
  } catch {
    return;
  }
}

/** Async viewer "today", reading the cookie directly. For request handlers. */
export async function viewerToday(days = 0): Promise<string> {
  return computeLocalDate(await readViewerTimeZone(), days);
}
