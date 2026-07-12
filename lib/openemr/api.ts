import "server-only";

import { auth } from "@/app/(auth)/auth";
import { isTestEnvironment } from "@/lib/constants";
import { resolveOpenEmrFixture } from "@/lib/openemr/fixtures";

const API_BASE =
  process.env.OPENEMR_API_BASE ?? "https://localhost:9300/apis/default";

export class OpenEmrNotConnectedError extends Error {
  constructor() {
    super("Current session is not connected to OpenEMR");
    this.name = "OpenEmrNotConnectedError";
  }
}

export class OpenEmrApiError extends Error {
  status: number;
  body: string;

  constructor(status: number, body: string) {
    // Include a snippet of the response body — a bare status code is not
    // enough to tell an auth failure from a missing route or a bad id.
    super(
      `OpenEMR API request failed (${status})${body ? `: ${body.slice(0, 200)}` : ""}`
    );
    this.name = "OpenEmrApiError";
    this.status = status;
    this.body = body;
  }
}

/**
 * Call the OpenEMR REST API as the currently signed-in user.
 *
 * `path` is relative to the API base, e.g. "/api/facility" (standard API) or
 * "/fhir/Patient" (FHIR API). The bearer token comes from the Auth.js session
 * captured during OpenEMR sign-in; token refresh is handled in the jwt callback.
 * Optional query params can be passed to append them to the request URL.
 */
export async function openemrFetch<T = unknown>(
  path: string,
  params?: Record<string, string | number | boolean | null | undefined>,
  init?: RequestInit
): Promise<T> {
  // Playwright runs have no OpenEMR instance: serve canned data instead
  // (before the token check — test sessions are never OpenEMR-connected).
  // Unknown paths 404 like the real API's legacy endpoints do.
  if (isTestEnvironment) {
    const fixture = resolveOpenEmrFixture(path, params);
    if (fixture === undefined) {
      throw new OpenEmrApiError(404, `No test fixture for ${path}`);
    }
    // Clone: callers mutate results (e.g. searchPatients sorts in place).
    return structuredClone(fixture) as T;
  }

  const session = await auth();
  const token = session?.openemr?.accessToken;

  if (!token) {
    throw new OpenEmrNotConnectedError();
  }

  const url = new URL(`${API_BASE}${path}`);

  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }

  // Self-signed TLS in dev is handled process-wide by instrumentation.ts
  // (OPENEMR_ALLOW_SELF_SIGNED). Do NOT toggle NODE_TLS_REJECT_UNAUTHORIZED
  // here: unsetting it after a request would clobber the global and break
  // Auth.js's token-refresh fetches for the rest of the process lifetime.
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...init?.headers,
      Authorization: `Bearer ${token}`,
    },
  });

  if (res.status === 401) {
    // The bearer token was rejected (expired or revoked server-side, e.g.
    // after an OpenEMR rebuild). Surface it as a connection problem so tools
    // and proxy routes report "reconnect to OpenEMR" instead of a raw API
    // error.
    throw new OpenEmrNotConnectedError();
  }

  if (!res.ok) {
    throw new OpenEmrApiError(res.status, await res.text());
  }

  return (await res.json()) as T;
}
