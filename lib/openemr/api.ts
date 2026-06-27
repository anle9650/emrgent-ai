import "server-only";

import { auth } from "@/app/(auth)/auth";

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
    super(`OpenEMR API request failed (${status})`);
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
  init?: RequestInit,
): Promise<T> {
  const session = await auth();
  const token = session?.openemr?.accessToken;

  if (!token) {
    throw new OpenEmrNotConnectedError();
  }

  const url = new URL(`${API_BASE}${path}`);

  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  });

  const allowInsecureSsl =
    process.env.OPENEMR_ALLOW_SELF_SIGNED === "true"

  if (allowInsecureSsl) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }

  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...init?.headers,
      Authorization: `Bearer ${token}`,
    },
  });

  if (allowInsecureSsl) {
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  }

  if (!res.ok) {
    throw new OpenEmrApiError(res.status, await res.text());
  }

  return (await res.json()) as T;
}
