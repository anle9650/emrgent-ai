/**
 * Where to send someone after they sign in or register.
 *
 * The auth pages are entered from elsewhere in the app — notably the OpenEMR
 * settings page, which guests can't use until they have an account — so they
 * carry a `?callbackUrl=` and must return the user to it rather than dropping
 * them on the home page.
 */

export const DEFAULT_CALLBACK_URL = "/";

/**
 * Accept only same-origin absolute paths. `//evil.example` is a
 * protocol-relative URL, not a local path, so it's rejected too — otherwise
 * this would be an open redirect.
 */
export function sanitizeCallbackUrl(raw: string | null | undefined): string {
  if (!raw?.startsWith("/") || raw.startsWith("//")) {
    return DEFAULT_CALLBACK_URL;
  }
  return raw;
}

/**
 * Read and sanitize the callback URL from the current location. Reads
 * `window.location` rather than `useSearchParams()` so it can be called from an
 * effect without forcing a Suspense boundary into the (auth) layout.
 */
export function readCallbackUrl(): string {
  if (typeof window === "undefined") {
    return DEFAULT_CALLBACK_URL;
  }
  return sanitizeCallbackUrl(
    new URLSearchParams(window.location.search).get("callbackUrl")
  );
}
