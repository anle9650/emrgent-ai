// The openemr proxy routes report errors as plain `{ error }` bodies (401
// not_connected_to_openemr / 502 openemr_api_error), not the `{code, cause}`
// shape the shared `fetcher` in lib/utils expects — so use a local one.
export class ProxyError extends Error {
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.status = status;
  }
}

export async function proxyFetcher<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ProxyError(body?.error ?? "request_failed", response.status);
  }
  return response.json();
}

export function isNotConnected(error: unknown) {
  return error instanceof ProxyError && error.status === 401;
}
